/**
 * Hourly forecasts, for counsel (MECHANICS-V2 §5.3).
 *
 * Kept apart from `WeatherCache` on purpose. That cache answers "what is the sky
 * doing *now*" for the router, one row per cell, on the hot path of every plan.
 * This answers "what will it be doing at 4 AM", 156 rows per cell, for a feature
 * that runs when somebody opens the compose screen. Two questions, two
 * lifecycles, two tables.
 *
 * **Never blocks a person** (MECHANICS-V2 §5.4). Counsel reads only what is
 * already cached; if coverage is thin it says nothing at all rather than making
 * anyone wait, which is the same posture REDTEAM F28 forced on the preview after
 * a cross-country quote took six minutes on a real phone.
 */

import { cellCenter } from '@smoke/shared';
import type { CellId, MechanicsConfig, WeatherCondition } from '@smoke/shared';

import type { SqlExecutor } from '../db/executor.js';
import { mapNwsCondition, parseWindDirection, parseWindSpeedMph } from './conditions.js';
import type { NwsClient } from './nws.js';

export interface ForecastHour {
  cell: CellId;
  validHour: Date;
  condition: WeatherCondition;
  windMph: number;
  windDirFromDeg: number;
  timeMult: number;
}

/** Truncate to the hour — the resolution NWS publishes and we store. */
export function floorToHour(at: Date): Date {
  const floored = new Date(at);
  floored.setUTCMinutes(0, 0, 0);
  return floored;
}

export class ForecastStore {
  constructor(
    private readonly db: SqlExecutor,
    private readonly config: MechanicsConfig,
    private readonly client: NwsClient,
    private readonly now: () => Date = () => new Date(),
    private readonly log: (message: string) => void = () => {},
  ) {}

  /**
   * What we already know about these cells, for these hours. **No fetching.**
   *
   * Keyed `cell@ISO-hour`. A caller that finds a key missing has its answer —
   * we do not know — and MECHANICS-V2 §5.4 says the right response to that is
   * silence, not a network call with somebody waiting on it.
   */
  async read(cells: readonly CellId[], from: Date, to: Date): Promise<Map<string, ForecastHour>> {
    const out = new Map<string, ForecastHour>();
    if (cells.length === 0) return out;

    const { rows } = await this.db.query<{
      cell: CellId;
      valid_hour: Date | string;
      condition: string | null;
      wind_mph: number | null;
      wind_dir: number | null;
      time_mult: string | number | null;
    }>(
      `select cell, valid_hour, condition, wind_mph, wind_dir, time_mult
         from public.forecast_hours
        where cell = any($1::text[]) and valid_hour >= $2 and valid_hour <= $3`,
      [cells as string[], floorToHour(from).toISOString(), floorToHour(to).toISOString()],
    );

    for (const row of rows) {
      const validHour = new Date(row.valid_hour);
      out.set(keyOf(row.cell, validHour), {
        cell: row.cell,
        validHour,
        condition: (row.condition ?? 'unknown') as WeatherCondition,
        windMph: row.wind_mph ?? 0,
        windDirFromDeg: row.wind_dir ?? 0,
        timeMult: Number(row.time_mult ?? 1),
      });
    }
    return out;
  }

  /** Which of these cells have no usable forecast rows left (TTL expired or absent). */
  async staleCells(cells: readonly CellId[]): Promise<CellId[]> {
    if (cells.length === 0) return [];
    const ttlMinutes = this.config.get('forecast.cache_ttl_minutes');
    const cutoff = new Date(this.now().getTime() - ttlMinutes * 60_000);

    const { rows } = await this.db.query<{ cell: CellId }>(
      `select distinct cell from public.forecast_hours
        where cell = any($1::text[]) and fetched_at > $2`,
      [cells as string[], cutoff.toISOString()],
    );
    const fresh = new Set(rows.map((row) => row.cell));
    return cells.filter((cell) => !fresh.has(cell));
  }

  /**
   * Fetch and store the horizon for these cells.
   *
   * Called only by the warming cron — never by anything a person is waiting on.
   */
  async warm(cells: readonly CellId[]): Promise<number> {
    const horizon = this.config.get('forecast.horizon_hours');
    const cutoff = new Date(this.now().getTime() + horizon * 3_600_000);
    let written = 0;

    for (const cell of cells) {
      let periods;
      try {
        periods = await this.client.getHourlyForecast(cellCenter(cell));
      } catch {
        // Same fail-open posture as the current-conditions cache (REDTEAM F4):
        // no hourly data means counsel is quiet, never that anything strands.
        continue;
      }
      if (periods === null) continue;

      const rows: ForecastHour[] = [];
      for (const period of periods) {
        const validHour = floorToHour(new Date(period.startTime));
        if (Number.isNaN(validHour.getTime()) || validHour > cutoff) continue;
        const condition = mapNwsCondition(period.shortForecast);
        rows.push({
          cell,
          validHour,
          condition,
          windMph: parseWindSpeedMph(period.windSpeed),
          windDirFromDeg: parseWindDirection(period.windDirection),
          timeMult: this.config.timeMultFor(condition),
        });
      }
      if (rows.length > 0) {
        await this.write(rows);
        written += rows.length;
      }
    }
    return written;
  }

  private async write(rows: readonly ForecastHour[]): Promise<void> {
    const now = this.now().toISOString();
    for (const row of rows) {
      await this.db.query(
        `insert into public.forecast_hours
           (cell, valid_hour, condition, wind_mph, wind_dir, time_mult, fetched_at)
         values ($1, $2, $3, $4, $5, $6, $7)
         on conflict (cell, valid_hour) do update set
           condition = excluded.condition,
           wind_mph = excluded.wind_mph,
           wind_dir = excluded.wind_dir,
           time_mult = excluded.time_mult,
           fetched_at = excluded.fetched_at`,
        [
          row.cell,
          row.validHour.toISOString(),
          row.condition,
          Math.round(row.windMph),
          Math.round(row.windDirFromDeg),
          row.timeMult,
          now,
        ],
      );
    }
  }

  /**
   * Delete forecasts for hours that have already happened (REDTEAM F43a).
   *
   * Without this the table only grows. With it, size is bounded by
   * `forecast.horizon_hours × cells ever warmed` — which is bounded in turn by
   * F31's rule that only corridors with recent traffic are warmed at all. The
   * bound scales with use, not with geography.
   */
  async sweepExpired(): Promise<number> {
    const { rows } = await this.db.query<{ count: string }>(
      `with gone as (delete from public.forecast_hours where valid_hour < $1 returning 1)
       select count(*)::text as count from gone`,
      [floorToHour(this.now()).toISOString()],
    );
    const removed = Number(rows[0]?.count ?? 0);
    if (removed > 0) this.log(`forecast: swept ${removed} expired hours`);
    return removed;
  }
}

export function keyOf(cell: CellId, hour: Date): string {
  return `${cell}@${floorToHour(hour).toISOString()}`;
}
