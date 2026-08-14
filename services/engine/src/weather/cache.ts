/**
 * Per-cell weather cache (ARCHITECTURE §6.1, MECHANICS §1, §2.1).
 *
 * Rules it implements, in the order they matter:
 *  1. **Open ocean is never fetched** (MECHANICS §1.1). It has no weather because
 *     it has no route, and fail-open must not turn the Atlantic into a highway.
 *  2. **Serve from `weather_cells` while fresh** (TTL from `mechanics_config`).
 *  3. **Fail open, always** (MECHANICS §2.1, REDTEAM F4): if NWS is down we serve
 *     stale data up to 2×TTL; past that, or with nothing cached at all, the cell
 *     is treated as clear and flagged `weather_unknown`. A message is stranded
 *     only by confirmed severe weather, never by our own missing data.
 *  4. **Impassable requires an active severe warning/watch** (REDTEAM F2), not a
 *     stormy forecast — an ordinary thunderstorm is 6.0× slow and passable.
 *
 * Fetches are batched with jittered spacing so a replan sweep does not arrive at
 * api.weather.gov as a burst. A 429 switches the cache into degraded mode, where
 * the longer TTL from `mechanics_config` applies (MECHANICS §9).
 */

import {
  cellCenter,
  cellsAlongGreatCircle,
  expandWithPadding,
  isTraversable,
} from '@smoke/shared';
import type { CellId, LatLng, MechanicsConfig, WeatherCondition } from '@smoke/shared';

import { NwsUnavailableError, isSevereAlert } from './nws.js';
import type { NwsClient } from './nws.js';
import { mapNwsCondition, parseWindDirection, parseWindSpeedMph } from './conditions.js';
import type { StoredWeather, WeatherStore } from './store.js';
import { snapshotFrom } from './types.js';
import type { CellWeather, WeatherSnapshot } from './types.js';

export interface WeatherCacheOptions {
  client: NwsClient;
  store: WeatherStore;
  config: MechanicsConfig;
  /** Injected clock — the crons and the tests both need to control it. */
  now?: () => Date;
  /** Injected randomness for fetch jitter; deterministic in tests. */
  random?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Concurrent NWS requests per pass. Infrastructure, not gameplay. */
  concurrency?: number;
  /** Upper bound of the random pre-request delay, in ms. */
  jitterMs?: number;
  log?: (msg: string) => void;
}

export interface WeatherPassStats {
  requested: number;
  ocean: number;
  cached: number;
  fetched: number;
  stale: number;
  failOpen: number;
  degraded: boolean;
}

const DEFAULT_CONCURRENCY = 4;
const DEFAULT_JITTER_MS = 250;

export class WeatherCache {
  private readonly client: NwsClient;
  private readonly store: WeatherStore;
  private readonly config: MechanicsConfig;
  private readonly now: () => Date;
  private readonly random: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly concurrency: number;
  private readonly jitterMs: number;
  private readonly log: (msg: string) => void;

  /** Set when NWS throttles us; until then the degraded TTL applies. */
  private degradedUntil: Date | null = null;

  lastStats: WeatherPassStats = {
    requested: 0,
    ocean: 0,
    cached: 0,
    fetched: 0,
    stale: 0,
    failOpen: 0,
    degraded: false,
  };

  constructor(options: WeatherCacheOptions) {
    this.client = options.client;
    this.store = options.store;
    this.config = options.config;
    this.now = options.now ?? (() => new Date());
    this.random = options.random ?? Math.random;
    this.sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;
    this.jitterMs = options.jitterMs ?? DEFAULT_JITTER_MS;
    this.log = options.log ?? (() => {});
  }

  /** Current TTL in ms, honouring degraded mode. */
  private ttlMs(now: Date): number {
    const degraded = this.degradedUntil !== null && this.degradedUntil.getTime() > now.getTime();
    const minutes = degraded
      ? this.config.get('weather.degraded_cache_ttl_minutes')
      : this.config.get('weather.cache_ttl_minutes');
    return minutes * 60_000;
  }

  private staleLimitMs(now: Date): number {
    return this.ttlMs(now) * this.config.get('weather.stale_ttl_multiplier_unknown');
  }

  /**
   * Weather for the cells a route might use: the great-circle corridor between
   * the endpoints, padded by `grid.prefetch_padding_cells` (MECHANICS §1).
   */
  async getCorridorWeather(origin: CellId, dest: CellId): Promise<WeatherSnapshot> {
    const corridor = cellsAlongGreatCircle(origin, dest);
    const padded = expandWithPadding(corridor, this.config.get('grid.prefetch_padding_cells'));
    return this.getCellWeather(padded);
  }

  async getCellWeather(cells: readonly CellId[]): Promise<WeatherSnapshot> {
    const now = this.now();
    const unique = [...new Set(cells)];
    const stats: WeatherPassStats = {
      requested: unique.length,
      ocean: 0,
      cached: 0,
      fetched: 0,
      stale: 0,
      failOpen: 0,
      degraded: this.degradedUntil !== null && this.degradedUntil.getTime() > now.getTime(),
    };

    const results: CellWeather[] = [];
    const routable: CellId[] = [];

    for (const cell of unique) {
      if (isTraversable(cell)) routable.push(cell);
      else {
        results.push(this.oceanEntry(cell, now));
        stats.ocean++;
      }
    }

    const stored = await this.store.read(routable);
    const ttl = this.ttlMs(now);
    const needFetch: CellId[] = [];

    for (const cell of routable) {
      const row = stored.get(cell);
      if (row && now.getTime() - row.fetchedAt.getTime() < ttl) {
        results.push({ ...row, cell, source: 'cache' });
        stats.cached++;
      } else {
        needFetch.push(cell);
      }
    }

    const writes: StoredWeather[] = [];

    await this.inBatches(needFetch, async (cell) => {
      const entry = await this.fetchCell(cell, stored.get(cell), now, stats);
      results.push(entry);
      // Fail-open entries are persisted too: during an NWS outage that stops us
      // re-asking for every cell on every pass, and `weather_unknown` records
      // that the clear sky is a guess, not an observation.
      if (entry.source === 'nws' || entry.source === 'fail_open') {
        writes.push({
          cell: entry.cell,
          condition: entry.condition,
          windMph: entry.windMph,
          windDirFromDeg: entry.windDirFromDeg,
          timeMult: entry.timeMult,
          impassable: entry.impassable,
          weatherUnknown: entry.weatherUnknown,
          fetchedAt: entry.fetchedAt,
        });
      }
    });

    if (writes.length) await this.store.write(writes);

    this.lastStats = stats;
    this.log(
      `weather: ${stats.cached} cached, ${stats.fetched} fetched, ${stats.stale} stale, ` +
        `${stats.failOpen} fail-open, ${stats.ocean} ocean${stats.degraded ? ' (degraded)' : ''}`,
    );

    return snapshotFrom(results);
  }

  private async fetchCell(
    cell: CellId,
    stored: StoredWeather | undefined,
    now: Date,
    stats: WeatherPassStats,
  ): Promise<CellWeather> {
    const center: LatLng = cellCenter(cell);

    if (this.jitterMs > 0) await this.sleep(Math.floor(this.random() * this.jitterMs));

    try {
      const [forecast, alerts] = await Promise.all([
        this.client.getForecast(center),
        this.client.getActiveAlerts(center),
      ]);

      const impassable =
        this.config.get('weather.severe_alert_impassable') &&
        alerts.some((alert) => isSevereAlert(alert, now));

      if (forecast === null) {
        // No NWS coverage here (Canada, Mexico, offshore). Not an outage.
        stats.failOpen++;
        return { ...this.failOpenEntry(cell, now), impassable };
      }

      const condition = mapNwsCondition(forecast.shortForecast);
      stats.fetched++;
      return {
        cell,
        condition,
        windMph: parseWindSpeedMph(forecast.windSpeed),
        windDirFromDeg: parseWindDirection(forecast.windDirection),
        timeMult: this.timeMultFor(condition),
        impassable,
        weatherUnknown: condition === 'unknown',
        fetchedAt: now,
        source: 'nws',
      };
    } catch (err) {
      if (err instanceof NwsUnavailableError) {
        if (err.isThrottled) this.enterDegradedMode(now);
        if (stored && now.getTime() - stored.fetchedAt.getTime() < this.staleLimitMs(now)) {
          stats.stale++;
          return { ...stored, cell, source: 'stale' };
        }
        stats.failOpen++;
        return this.failOpenEntry(cell, now);
      }
      throw err;
    }
  }

  private enterDegradedMode(now: Date): void {
    const minutes = this.config.get('weather.degraded_cache_ttl_minutes');
    this.degradedUntil = new Date(now.getTime() + minutes * 60_000);
    this.log(`weather: NWS throttled us; degraded TTL for ${minutes} min`);
  }

  private timeMultFor(condition: WeatherCondition): number {
    return this.config.timeMultFor(condition);
  }

  /** Clear, but flagged: we are guessing (MECHANICS §2.1). */
  private failOpenEntry(cell: CellId, now: Date): CellWeather {
    return {
      cell,
      condition: 'unknown',
      windMph: 0,
      windDirFromDeg: 0,
      timeMult: this.config.get('weather.unknown_time_mult'),
      impassable: false,
      weatherUnknown: true,
      fetchedAt: now,
      source: 'fail_open',
    };
  }

  /** Structurally impassable; no weather is ever fetched for it. */
  private oceanEntry(cell: CellId, now: Date): CellWeather {
    return {
      cell,
      condition: 'unknown',
      windMph: 0,
      windDirFromDeg: 0,
      timeMult: this.config.get('weather.unknown_time_mult'),
      impassable: true,
      weatherUnknown: false,
      fetchedAt: now,
      source: 'ocean',
    };
  }

  private async inBatches<T>(items: readonly T[], worker: (item: T) => Promise<void>): Promise<void> {
    for (let i = 0; i < items.length; i += this.concurrency) {
      const batch = items.slice(i, i + this.concurrency);
      await Promise.all(batch.map(worker));
    }
  }
}
