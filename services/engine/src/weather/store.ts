/**
 * Persistence for the weather cache — the `weather_cells` table (ARCHITECTURE §3).
 *
 * Behind an interface so the cache can be tested without a database, and so the
 * cron path and the preview path share one implementation.
 */

import type { CellId, WeatherCondition } from '@smoke/shared';

import type { SqlExecutor } from '../db/executor.js';

export interface StoredWeather {
  cell: CellId;
  condition: WeatherCondition;
  windMph: number;
  windDirFromDeg: number;
  timeMult: number;
  impassable: boolean;
  weatherUnknown: boolean;
  fetchedAt: Date;
}

export interface WeatherStore {
  read(cells: readonly CellId[]): Promise<Map<CellId, StoredWeather>>;
  write(rows: readonly StoredWeather[]): Promise<void>;
}

export class MemoryWeatherStore implements WeatherStore {
  private readonly rows = new Map<CellId, StoredWeather>();

  async read(cells: readonly CellId[]): Promise<Map<CellId, StoredWeather>> {
    const out = new Map<CellId, StoredWeather>();
    for (const cell of cells) {
      const row = this.rows.get(cell);
      if (row) out.set(cell, { ...row });
    }
    return out;
  }

  async write(rows: readonly StoredWeather[]): Promise<void> {
    for (const row of rows) this.rows.set(row.cell, { ...row });
  }

  /** Test/debug helper. */
  all(): StoredWeather[] {
    return [...this.rows.values()].map((r) => ({ ...r }));
  }
}

interface WeatherRow {
  cell: string;
  condition: string | null;
  wind_mph: number | null;
  wind_dir: number | null;
  time_mult: string | number | null;
  impassable: boolean;
  weather_unknown: boolean;
  fetched_at: string | Date | null;
}

export class SqlWeatherStore implements WeatherStore {
  constructor(private readonly db: SqlExecutor) {}

  async read(cells: readonly CellId[]): Promise<Map<CellId, StoredWeather>> {
    const out = new Map<CellId, StoredWeather>();
    if (cells.length === 0) return out;

    const { rows } = await this.db.query<WeatherRow>(
      `select cell, condition, wind_mph, wind_dir, time_mult, impassable, weather_unknown, fetched_at
         from public.weather_cells
        where cell = any($1::text[])`,
      [cells as CellId[]],
    );

    for (const row of rows) {
      if (!row.fetched_at) continue; // never fetched: treat as absent
      out.set(row.cell, {
        cell: row.cell,
        condition: (row.condition ?? 'unknown') as WeatherCondition,
        windMph: row.wind_mph ?? 0,
        windDirFromDeg: row.wind_dir ?? 0,
        timeMult: Number(row.time_mult ?? 1),
        impassable: row.impassable,
        weatherUnknown: row.weather_unknown,
        fetchedAt: new Date(row.fetched_at),
      });
    }
    return out;
  }

  async write(rows: readonly StoredWeather[]): Promise<void> {
    for (const row of rows) {
      await this.db.query(
        `insert into public.weather_cells
           (cell, condition, wind_mph, wind_dir, time_mult, impassable, weather_unknown, fetched_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8)
         on conflict (cell) do update
            set condition = excluded.condition,
                wind_mph = excluded.wind_mph,
                wind_dir = excluded.wind_dir,
                time_mult = excluded.time_mult,
                impassable = excluded.impassable,
                weather_unknown = excluded.weather_unknown,
                fetched_at = excluded.fetched_at`,
        [
          row.cell,
          row.condition,
          Math.round(row.windMph),
          Math.round(row.windDirFromDeg) % 360,
          row.timeMult,
          row.impassable,
          row.weatherUnknown,
          row.fetchedAt.toISOString(),
        ],
      );
    }
  }
}
