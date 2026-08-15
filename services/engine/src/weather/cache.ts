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
  cellsInBoundingBox,
  expandWithPadding,
  isTraversable,
} from '@smoke/shared';
import type { CellId, LatLng, MechanicsConfig, WeatherCondition } from '@smoke/shared';

import { NwsUnavailableError, isSevereAlert } from './nws.js';
import type { NwsAlert, NwsClient } from './nws.js';
import { pointInAlert } from './geometry.js';
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
  /** Structurally impassable: open ocean or foreign land (MECHANICS §1.1). */
  ocean: number;
  cached: number;
  fetched: number;
  stale: number;
  failOpen: number;
  degraded: boolean;
  /** Cells walled off by an active severe alert this pass. */
  alerted: number;
  /** Active severe alerts that arrived without geometry, so could not be matched. */
  unmatchedAlerts: number;
  /**
   * Age in minutes of the alert list this pass planned against, or null when we
   * had none at all. An outage un-walls the sky (fail-open, REDTEAM F4) and this
   * is how that becomes visible rather than silent (REDTEAM F23) — surface it in
   * the nightly report.
   */
  alertStalenessMinutes: number | null;
}

// REDTEAM F31. Operational, not gameplay: concurrency changes no outcome, only
// how fast we learn the sky. At 4 the measured throughput was 0.94 cells/sec,
// which put a cross-country preview six minutes past a 45-second timeout.
const DEFAULT_CONCURRENCY = 12;
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

  /** Active alerts for the whole region, refreshed once per TTL (REDTEAM F19). */
  private alerts: { fetchedAt: Date; list: NwsAlert[] } | null = null;

  lastStats: WeatherPassStats = {
    requested: 0,
    ocean: 0,
    cached: 0,
    fetched: 0,
    stale: 0,
    failOpen: 0,
    degraded: false,
    alerted: 0,
    unmatchedAlerts: 0,
    alertStalenessMinutes: null,
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
   * Weather for the cells a route might use: the **bounding box** of the
   * great-circle corridor, padded by `grid.prefetch_padding_cells` (MECHANICS §1
   * — "cells inside the bounding boxes of in-flight routes (+1 cell padding)").
   *
   * A box rather than a line, deliberately: under fail-open an unfetched cell is
   * priced as clear, so a narrow corridor hands the router an attractive unknown
   * frontier to detour into — and a message that should be sheltering would sail
   * around the storm through terrain nobody has looked at.
   */
  async getCorridorWeather(origin: CellId, dest: CellId): Promise<WeatherSnapshot> {
    const corridor = cellsAlongGreatCircle(origin, dest);
    const box = cellsInBoundingBox(corridor);
    const padded = expandWithPadding(box, this.config.get('grid.prefetch_padding_cells'));
    return this.getCellWeather(padded);
  }

  /**
   * What we already know, without asking NWS anything (REDTEAM F28).
   *
   * A preview plans on this first so that the candidate route is chosen from
   * knowledge in hand, and only then spends its budget resolving that route's
   * own cells.
   */
  async getCachedWeather(cells: readonly CellId[]): Promise<WeatherSnapshot> {
    return this.getCellWeather(cells, { deadline: new Date(0) });
  }

  async getCellWeather(
    cells: readonly CellId[],
    options: { deadline?: Date } = {},
  ): Promise<WeatherSnapshot> {
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
      alerted: 0,
      unmatchedAlerts: 0,
      alertStalenessMinutes: null,
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

    // One alert fetch covers the whole pass, so alerts are re-evaluated for
    // *every* cell — including ones served from cache. A severe warning that
    // appeared five minutes ago must strand a message now, not when the 30-minute
    // weather TTL happens to expire.
    const severe = await this.refreshAlerts(now, stats);
    const isAlerted = (cell: CellId): boolean =>
      severe.length > 0 &&
      this.config.get('weather.severe_alert_impassable') &&
      severe.some((alert) => pointInAlert(alert.geometry, cellCenter(cell)));

    const stored = await this.store.read(routable);
    const ttl = this.ttlMs(now);
    const needFetch: CellId[] = [];
    const writes: StoredWeather[] = [];

    for (const cell of routable) {
      const row = stored.get(cell);
      if (row && now.getTime() - row.fetchedAt.getTime() < ttl) {
        const impassable = isAlerted(cell);
        if (impassable) stats.alerted++;
        results.push({ ...row, cell, impassable, source: 'cache' });
        stats.cached++;
        if (impassable !== row.impassable) writes.push({ ...row, cell, impassable });
      } else {
        needFetch.push(cell);
      }
    }

    await this.inBatches(needFetch, options.deadline, async (cell) => {
      const fetched = await this.fetchCell(cell, stored.get(cell), now, stats);
      const impassable = isAlerted(cell);
      if (impassable) stats.alerted++;
      const entry = { ...fetched, impassable };
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
        `${stats.failOpen} fail-open, ${stats.ocean} unroutable, ${stats.alerted} alerted` +
        `${stats.degraded ? ' (degraded)' : ''}` +
        (stats.alertStalenessMinutes === null
          ? ' [alerts: NONE — the sky is un-walled]'
          : stats.alertStalenessMinutes > 0
            ? ` [alerts: ${stats.alertStalenessMinutes.toFixed(0)} min stale]`
            : ''),
    );

    return snapshotFrom(results);
  }

  /**
   * Refresh the region-wide alert list if it is older than the TTL, and return
   * the severe ones (MECHANICS §2.1, REDTEAM F2/F19).
   *
   * Fail-open applies here too: if the alerts endpoint is down we keep the last
   * list we saw while it is inside the stale window, and otherwise assume no
   * alerts. Never strand on missing data — only on confirmed severe weather.
   */
  private async refreshAlerts(now: Date, stats: WeatherPassStats): Promise<NwsAlert[]> {
    // Alerts are refreshed on *every* pass, never cached for a TTL: they are one
    // cheap request, and they are the only thing that can wall a cell off. A
    // warning that appeared five minutes ago has to strand a message now, not
    // when the 30-minute forecast TTL happens to lapse.
    try {
      this.alerts = { fetchedAt: now, list: await this.client.getActiveAlerts() };
    } catch (err) {
      if (!(err instanceof NwsUnavailableError)) throw err;
      if (err.isThrottled) this.enterDegradedMode(now);
      const staleOk =
        this.alerts !== null &&
        now.getTime() - this.alerts.fetchedAt.getTime() < this.staleLimitMs(now);
      if (!staleOk) {
        this.log('weather: alerts unavailable and stale — assuming none (fail-open)');
        this.alerts = null;
      }
    }

    stats.alertStalenessMinutes =
      this.alerts === null
        ? null
        : (now.getTime() - this.alerts.fetchedAt.getTime()) / 60_000;

    const severe = (this.alerts?.list ?? []).filter((alert) => isSevereAlert(alert, now));
    // Zone-based alerts (many watches) carry no polygon, so they cannot be matched
    // to cells. Counted here rather than guessed at: turning a whole state
    // impassable on an unmatched watch would strand far more than it protects.
    stats.unmatchedAlerts = severe.filter((alert) => !alert.geometry).length;
    return severe.filter((alert) => alert.geometry);
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
      const forecast = await this.client.getForecast(center);

      if (forecast === null) {
        // No NWS coverage here (Canada, Mexico, offshore). Not an outage.
        stats.failOpen++;
        return this.failOpenEntry(cell, now);
      }

      const condition = mapNwsCondition(forecast.shortForecast);
      stats.fetched++;
      return {
        cell,
        condition,
        windMph: parseWindSpeedMph(forecast.windSpeed),
        windDirFromDeg: parseWindDirection(forecast.windDirection),
        timeMult: this.timeMultFor(condition),
        impassable: false, // decided by the pass-level alert set
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

  /**
   * Fetch in batches, stopping when the deadline passes (REDTEAM F28).
   *
   * Cells we never reach are simply left out of the snapshot, which is not a
   * failure: an absent cell is priced at `routing.unknown_cost_mult` and the
   * route is quoted as a band. The alternative — keep fetching until every cell
   * is known — is what left someone staring at a spinner for ten minutes.
   *
   * The check is between batches rather than mid-flight: a request already sent
   * is paid for whether or not we wait for it, so we may as well keep the answer.
   */
  private async inBatches<T>(
    items: readonly T[],
    deadline: Date | undefined,
    worker: (item: T) => Promise<void>,
  ): Promise<void> {
    for (let i = 0; i < items.length; i += this.concurrency) {
      if (deadline !== undefined && this.now().getTime() >= deadline.getTime()) {
        this.log(
          `weather: budget spent with ${items.length - i} of ${items.length} cells unfetched`,
        );
        return;
      }
      const batch = items.slice(i, i + this.concurrency);
      await Promise.all(batch.map(worker));
    }
  }
}
