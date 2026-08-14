/**
 * Weather cache behaviour (ARCHITECTURE §6.1, MECHANICS §1.1/§2.1, REDTEAM F4).
 *
 * The rule that gets the most attention here is fail-open: NWS is flaky, and an
 * outage must never strand the whole network. Every failure path below ends with
 * a routable cell, not a wall.
 */

import { MECHANICS_DEFAULTS, cellId, formatCellId, isLand, isTraversable } from '@smoke/shared';
import type { LatLng } from '@smoke/shared';
import { beforeEach, describe, expect, it } from 'vitest';

import { WeatherCache } from '../../src/weather/cache.js';
import { MemoryWeatherStore } from '../../src/weather/store.js';
import { NwsUnavailableError } from '../../src/weather/nws.js';
import type { NwsAlert, NwsClient, NwsForecast } from '../../src/weather/nws.js';
import { CELLS, CONFIG } from '../fixtures/weather.js';

const TTL_MINUTES = MECHANICS_DEFAULTS['weather.cache_ttl_minutes'];
const START = new Date('2026-08-14T12:00:00.000Z');

class FakeNws implements NwsClient {
  forecast: NwsForecast | null = {
    shortForecast: 'Mostly Cloudy',
    windSpeed: '10 mph',
    windDirection: 'SW',
  };
  alerts: NwsAlert[] = [];
  failWith: NwsUnavailableError | null = null;
  forecastCalls: LatLng[] = [];
  alertCalls: LatLng[] = [];
  inFlight = 0;
  maxInFlight = 0;

  async getForecast(point: LatLng): Promise<NwsForecast | null> {
    this.inFlight++;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    try {
      this.forecastCalls.push(point);
      if (this.failWith) throw this.failWith;
      return this.forecast;
    } finally {
      this.inFlight--;
    }
  }

  async getActiveAlerts(point: LatLng): Promise<NwsAlert[]> {
    this.alertCalls.push(point);
    if (this.failWith) throw this.failWith;
    return this.alerts;
  }
}

let client: FakeNws;
let store: MemoryWeatherStore;
let now: Date;
let slept: number[];

function makeCache(overrides: Partial<ConstructorParameters<typeof WeatherCache>[0]> = {}) {
  return new WeatherCache({
    client,
    store,
    config: CONFIG,
    now: () => now,
    random: () => 0.5,
    sleep: async (ms) => {
      slept.push(ms);
    },
    ...overrides,
  });
}

const advance = (minutes: number): void => {
  now = new Date(now.getTime() + minutes * 60_000);
};

beforeEach(() => {
  client = new FakeNws();
  store = new MemoryWeatherStore();
  now = new Date(START);
  slept = [];
});

describe('fetching and mapping', () => {
  it('fetches a cell, maps the forecast and persists it', async () => {
    const cache = makeCache();
    const snapshot = await cache.getCellWeather([CELLS.newark]);
    const entry = snapshot.get(CELLS.newark)!;

    expect(entry.source).toBe('nws');
    expect(entry.condition).toBe('overcast');
    expect(entry.timeMult).toBe(MECHANICS_DEFAULTS['weather.time_mult'].overcast);
    expect(entry.windMph).toBe(10);
    expect(entry.windDirFromDeg).toBe(225);
    expect(entry.impassable).toBe(false);
    expect(entry.weatherUnknown).toBe(false);

    expect(store.all()).toHaveLength(1);
    expect(client.forecastCalls).toHaveLength(1);
  });

  it('samples the centre of the cell', async () => {
    await makeCache().getCellWeather([CELLS.chicago]);
    const point = client.forecastCalls[0]!;
    expect(cellId(point)).toBe(CELLS.chicago);
  });

  it('deduplicates the request list', async () => {
    await makeCache().getCellWeather([CELLS.newark, CELLS.newark, CELLS.newark]);
    expect(client.forecastCalls).toHaveLength(1);
  });
});

describe('TTL (MECHANICS §1)', () => {
  it('serves from cache inside the TTL without calling NWS again', async () => {
    const cache = makeCache();
    await cache.getCellWeather([CELLS.newark]);

    advance(TTL_MINUTES - 1);
    const snapshot = await cache.getCellWeather([CELLS.newark]);

    expect(snapshot.get(CELLS.newark)!.source).toBe('cache');
    expect(client.forecastCalls).toHaveLength(1);
    expect(cache.lastStats.cached).toBe(1);
  });

  it('refetches once the TTL has passed', async () => {
    const cache = makeCache();
    await cache.getCellWeather([CELLS.newark]);

    advance(TTL_MINUTES + 1);
    const snapshot = await cache.getCellWeather([CELLS.newark]);

    expect(snapshot.get(CELLS.newark)!.source).toBe('nws');
    expect(client.forecastCalls).toHaveLength(2);
  });

  it('switches to the degraded TTL after a 429 (MECHANICS §9)', async () => {
    const cache = makeCache();
    client.failWith = new NwsUnavailableError('rate limited', 429);
    await cache.getCellWeather([CELLS.newark]);
    expect(cache.lastStats.failOpen).toBe(1);

    client.failWith = null;
    advance(TTL_MINUTES + 1); // past the normal TTL...
    await cache.getCellWeather([CELLS.newark]);
    // ...but inside the degraded one, so the negative cache still stands.
    expect(cache.lastStats.cached).toBe(1);
    expect(cache.lastStats.degraded).toBe(true);

    advance(MECHANICS_DEFAULTS['weather.degraded_cache_ttl_minutes']);
    await cache.getCellWeather([CELLS.newark]);
    expect(cache.lastStats.fetched).toBe(1);
  });
});

describe('fail-open (MECHANICS §2.1, REDTEAM F4)', () => {
  it('serves stale data when NWS is down, up to 2×TTL', async () => {
    const cache = makeCache();
    await cache.getCellWeather([CELLS.newark]);

    client.failWith = new NwsUnavailableError('boom', 503);
    advance(TTL_MINUTES + 5);
    const snapshot = await cache.getCellWeather([CELLS.newark]);

    const entry = snapshot.get(CELLS.newark)!;
    expect(entry.source).toBe('stale');
    expect(entry.condition).toBe('overcast'); // the last thing we actually saw
    expect(cache.lastStats.stale).toBe(1);
  });

  it('treats data staler than 2×TTL as clear, and says it is guessing', async () => {
    const cache = makeCache();
    await cache.getCellWeather([CELLS.newark]);

    client.failWith = new NwsUnavailableError('still down', 503);
    advance(TTL_MINUTES * 2 + 1);
    const entry = (await cache.getCellWeather([CELLS.newark])).get(CELLS.newark)!;

    expect(entry.source).toBe('fail_open');
    expect(entry.condition).toBe('unknown');
    expect(entry.timeMult).toBe(MECHANICS_DEFAULTS['weather.unknown_time_mult']);
    expect(entry.weatherUnknown).toBe(true);
    expect(entry.impassable).toBe(false);
  });

  it('never strands a cell we have never managed to fetch', async () => {
    client.failWith = new NwsUnavailableError('cold start during an outage', 500);
    const entry = (await makeCache().getCellWeather([CELLS.newark])).get(CELLS.newark)!;

    expect(entry.impassable).toBe(false);
    expect(entry.weatherUnknown).toBe(true);
    expect(entry.timeMult).toBe(MECHANICS_DEFAULTS['weather.unknown_time_mult']);
  });

  it('negative-caches an outage so a replan sweep does not hammer NWS', async () => {
    const cache = makeCache();
    client.failWith = new NwsUnavailableError('down', 500);
    await cache.getCellWeather([CELLS.newark]);
    const callsAfterFirst = client.forecastCalls.length;

    advance(1);
    await cache.getCellWeather([CELLS.newark]);
    expect(client.forecastCalls).toHaveLength(callsAfterFirst);
  });

  it('fails open where NWS simply has no data (Canada, Mexico, offshore)', async () => {
    client.forecast = null;
    const entry = (await makeCache().getCellWeather([CELLS.newark])).get(CELLS.newark)!;
    expect(entry.source).toBe('fail_open');
    expect(entry.weatherUnknown).toBe(true);
  });
});

describe('impassability requires an active severe alert (REDTEAM F2)', () => {
  it('does not wall off an ordinary thunderstorm forecast', async () => {
    client.forecast = {
      shortForecast: 'Showers And Thunderstorms',
      windSpeed: '15 mph',
      windDirection: 'W',
    };
    const entry = (await makeCache().getCellWeather([CELLS.chicago])).get(CELLS.chicago)!;

    expect(entry.condition).toBe('thunderstorm');
    expect(entry.timeMult).toBe(MECHANICS_DEFAULTS['weather.time_mult'].thunderstorm);
    expect(entry.impassable).toBe(false);
  });

  it('walls off a cell under an active severe warning', async () => {
    client.alerts = [
      {
        event: 'Severe Thunderstorm Warning',
        severity: 'Severe',
        status: 'Actual',
        messageType: 'Alert',
        ends: new Date(START.getTime() + 3_600_000).toISOString(),
      },
    ];
    const entry = (await makeCache().getCellWeather([CELLS.chicago])).get(CELLS.chicago)!;
    expect(entry.impassable).toBe(true);
  });

  it('ignores advisories', async () => {
    client.alerts = [
      { event: 'Heat Advisory', severity: 'Moderate', status: 'Actual', messageType: 'Alert' },
    ];
    const entry = (await makeCache().getCellWeather([CELLS.chicago])).get(CELLS.chicago)!;
    expect(entry.impassable).toBe(false);
  });
});

describe('the ocean is never fetched (MECHANICS §1.1)', () => {
  const OPEN_OCEAN = cellId({ lat: 33.0, lng: -73.0 });

  it('returns an impassable entry without calling NWS', async () => {
    const cache = makeCache();
    const entry = (await cache.getCellWeather([OPEN_OCEAN])).get(OPEN_OCEAN)!;

    expect(entry.source).toBe('ocean');
    expect(entry.impassable).toBe(true);
    expect(client.forecastCalls).toHaveLength(0);
    expect(client.alertCalls).toHaveLength(0);
    expect(store.all()).toHaveLength(0);
    expect(cache.lastStats.ocean).toBe(1);
  });

  it('still fetches coastal water, which smoke may cross', async () => {
    const coastal = formatCellId({ row: 19, col: 81 }); // just off the Carolina coast
    expect(isLand(coastal)).toBe(false);
    expect(isTraversable(coastal)).toBe(true);

    const cache = makeCache();
    const entry = (await cache.getCellWeather([coastal])).get(coastal)!;
    expect(entry.source).toBe('nws');
    expect(entry.impassable).toBe(false);
    expect(client.forecastCalls).toHaveLength(1);
    expect(cache.lastStats.ocean).toBe(0);
  });
});

describe('batching and jitter', () => {
  it('spaces requests with jitter and respects the concurrency limit', async () => {
    const cells = Array.from({ length: 9 }, (_, i) => formatCellId({ row: 37, col: 80 + i }));
    const cache = makeCache({ concurrency: 3, jitterMs: 200 });
    await cache.getCellWeather(cells);

    expect(client.maxInFlight).toBeLessThanOrEqual(3);
    expect(slept).toHaveLength(cells.length);
    expect(new Set(slept)).toEqual(new Set([100])); // random() = 0.5 of 200 ms
  });

  it('reports what it did', async () => {
    const cache = makeCache();
    await cache.getCellWeather([CELLS.newark, CELLS.chicago, cellId({ lat: 33.0, lng: -73.0 })]);
    expect(cache.lastStats).toMatchObject({ requested: 3, fetched: 2, ocean: 1, cached: 0 });
  });
});

describe('corridor prefetch (MECHANICS §1)', () => {
  it('covers the great-circle corridor plus the configured padding', async () => {
    const cache = makeCache();
    const snapshot = await cache.getCorridorWeather(CELLS.newark, CELLS.chicago);

    // Every cell of the direct corridor is present...
    const corridorCells = [...snapshot.cells()];
    expect(corridorCells).toContain(CELLS.newark);
    expect(corridorCells).toContain(CELLS.chicago);
    // ...and padding makes the set meaningfully wider than the bare path.
    expect(snapshot.size).toBeGreaterThan(60);
    expect(cache.lastStats.requested).toBe(snapshot.size);
  });
});
