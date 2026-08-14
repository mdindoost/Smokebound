/**
 * Harness for the lifecycle tests: a real Postgres (PGlite), a real weather
 * cache and router, a scripted NWS, and a clock we can push forty hours forward
 * in a millisecond (ARCHITECTURE §9).
 *
 * Nothing is stubbed that the engine actually depends on — the only fakes are
 * the outside world (NWS), time, and the dice.
 */

import {
  GRID,
  MechanicsConfig,
  cellCenter,
  cellId,
  mechanicsSeedRows,
} from '@smoke/shared';
import type { CellId, LatLng, Uuid, WeatherCondition } from '@smoke/shared';

import { createEngineContext } from '../../src/engine/context.js';
import type { EngineContext } from '../../src/engine/context.js';
import type { Clock } from '../../src/engine/clock.js';
import { RecordingPushDispatcher } from '../../src/engine/push.js';
import { seededRng } from '../../src/engine/rng.js';
import type { Rng } from '../../src/engine/rng.js';
import { WeatherCache } from '../../src/weather/cache.js';
import { MemoryWeatherStore } from '../../src/weather/store.js';
import type { NwsAlert, NwsClient, NwsForecast } from '../../src/weather/nws.js';
import { ensureKeeper, ensureKeeperFlock, KEEPER_ID } from '../../src/messages/keeper.js';
import { createFlock, createTestDatabase, createUser } from '../harness.js';
import type { TestDatabase } from '../harness.js';

export class TestClock implements Clock {
  constructor(private current: Date) {}

  now(): Date {
    return new Date(this.current);
  }

  set(at: Date): void {
    this.current = new Date(at);
  }

  advanceMinutes(minutes: number): void {
    this.current = new Date(this.current.getTime() + minutes * 60_000);
  }

  advanceHours(hours: number): void {
    this.advanceMinutes(hours * 60);
  }

  advanceSeconds(seconds: number): void {
    this.current = new Date(this.current.getTime() + seconds * 1000);
  }
}

// Calm by default so flight times match the MECHANICS §7 worked examples;
// tests that care about wind set it explicitly.
const CLEAR: NwsForecast = { shortForecast: 'Sunny', windSpeed: '0 mph', windDirection: 'W' };

/** A programmable NWS: set the sky per cell, and put warnings over cells. */
export class ScriptedNws implements NwsClient {
  private readonly forecasts = new Map<CellId, NwsForecast>();
  alerts: NwsAlert[] = [];
  fallback: NwsForecast | null = CLEAR;
  forecastCalls = 0;
  alertCalls = 0;

  setForecast(cells: readonly CellId[], forecast: Partial<NwsForecast>): void {
    for (const cell of cells) this.forecasts.set(cell, { ...CLEAR, ...forecast });
  }

  /** A gale strong enough to roll garble (MECHANICS §2.2). */
  setGale(cells: readonly CellId[], mph = 55): void {
    this.setForecast(cells, { windSpeed: `${mph} mph`, windDirection: 'N' });
  }

  /** Put an active severe warning over these cells (REDTEAM F2). */
  setSevereOver(cells: readonly CellId[], event = 'Severe Thunderstorm Warning'): void {
    this.alerts = cells.map((cell) => ({
      event,
      severity: 'Severe',
      status: 'Actual',
      messageType: 'Alert',
      ends: null,
      geometry: cellPolygon(cellCenter(cell)),
    }));
  }

  clearAlerts(): void {
    this.alerts = [];
  }

  async getForecast(point: LatLng): Promise<NwsForecast | null> {
    this.forecastCalls++;
    const cell = cellId(point);
    return this.forecasts.get(cell) ?? this.fallback;
  }

  async getActiveAlerts(): Promise<NwsAlert[]> {
    this.alertCalls++;
    return this.alerts;
  }
}

/** A polygon covering (a little less than) one cell. */
function cellPolygon(center: LatLng): NwsAlert['geometry'] {
  const halfLat = (GRID.latStepDeg / 2) * 0.9;
  const halfLng = (GRID.lngStepDeg / 2) * 0.9;
  return {
    type: 'Polygon',
    coordinates: [
      [
        [center.lng - halfLng, center.lat - halfLat],
        [center.lng + halfLng, center.lat - halfLat],
        [center.lng + halfLng, center.lat + halfLat],
        [center.lng - halfLng, center.lat + halfLat],
        [center.lng - halfLng, center.lat - halfLat],
      ],
    ],
  };
}

export const PEOPLE = {
  alice: {
    id: '11111111-1111-4111-8111-111111111111' as Uuid,
    handle: 'alice',
    home: cellId({ lat: 40.7357, lng: -74.1724 }), // Newark
  },
  bob: {
    id: '22222222-2222-4222-8222-222222222222' as Uuid,
    handle: 'bob',
    home: cellId({ lat: 41.8781, lng: -87.6298 }), // Chicago
  },
  carol: {
    id: '33333333-3333-4333-8333-333333333333' as Uuid,
    handle: 'carol',
    home: cellId({ lat: 39.7392, lng: -104.9903 }), // Denver
  },
  mallory: {
    id: '44444444-4444-4444-8444-444444444444' as Uuid,
    handle: 'mallory',
    home: cellId({ lat: 42.3314, lng: -83.0458 }), // Detroit
  },
} as const;

export interface Lifecycle {
  t: TestDatabase;
  ctx: EngineContext;
  clock: TestClock;
  push: RecordingPushDispatcher;
  nws: ScriptedNws;
  weather: WeatherCache;
  store: MemoryWeatherStore;
  config: MechanicsConfig;
  /**
   * Write weather straight into the cache's store, as if it had just been
   * fetched. Lets a test change the sky inside the 30-minute TTL.
   */
  observeWeather(cells: readonly CellId[], condition: WeatherCondition): Promise<void>;
  close(): Promise<void>;
}

export interface LifecycleOptions {
  start?: Date;
  rng?: Rng;
  /** Seed the Keeper account and flock everyone to it. */
  withKeeper?: boolean;
}

export const START = new Date('2026-08-14T12:00:00.000Z');

export async function createLifecycle(options: LifecycleOptions = {}): Promise<Lifecycle> {
  const t = await createTestDatabase();
  await t.migrate();

  const config = MechanicsConfig.fromRows(mechanicsSeedRows());
  const clock = new TestClock(options.start ?? START);
  const push = new RecordingPushDispatcher();
  const nws = new ScriptedNws();

  const store = new MemoryWeatherStore();
  const weather = new WeatherCache({
    client: nws,
    store,
    config,
    now: () => clock.now(),
    random: () => 0.5,
    sleep: async () => {},
    jitterMs: 0,
    concurrency: 8,
  });

  for (const person of Object.values(PEOPLE)) {
    await createUser(t, person.id, person.handle, person.home);
  }
  await createFlock(t, PEOPLE.alice.id, PEOPLE.bob.id, 'accepted', PEOPLE.alice.id);
  await createFlock(t, PEOPLE.alice.id, PEOPLE.mallory.id, 'accepted', PEOPLE.alice.id);

  const keeperId = options.withKeeper ? await seedKeeper(t) : null;

  const ctx = createEngineContext({
    db: t.db,
    config,
    weather,
    push,
    clock,
    rng: options.rng ?? seededRng('lifecycle-tests'),
    previewSecret: 'test-preview-secret',
    keeperId,
  });

  const observeWeather = async (
    cells: readonly CellId[],
    condition: WeatherCondition,
  ): Promise<void> => {
    await store.write(
      cells.map((cell) => ({
        cell,
        condition,
        windMph: 0,
        windDirFromDeg: 0,
        timeMult: config.timeMultFor(condition),
        impassable: false,
        weatherUnknown: false,
        fetchedAt: clock.now(),
      })),
    );
    // The scripted NWS agrees, so a later refetch sees the same sky.
    nws.setForecast(cells, { shortForecast: NWS_TEXT[condition] });
  };

  return { t, ctx, clock, push, nws, weather, store, config, observeWeather, close: () => t.close() };
}

/** Forecast wording that maps back to each condition bucket. */
const NWS_TEXT: Record<WeatherCondition, string> = {
  clear: 'Sunny',
  few_clouds: 'Partly Cloudy',
  overcast: 'Mostly Cloudy',
  fog: 'Patchy Fog',
  mist: 'Haze',
  drizzle: 'Light Drizzle',
  light_rain: 'Light Rain',
  snow: 'Snow',
  heavy_rain: 'Heavy Rain',
  thunderstorm: 'Thunderstorms',
  unknown: 'Frogs',
};

async function seedKeeper(t: TestDatabase): Promise<Uuid> {
  await t.asEngine();
  await ensureKeeper(t.db, cellId({ lat: 39.0997, lng: -94.5786 })); // Kansas City
  for (const person of Object.values(PEOPLE)) {
    await ensureKeeperFlock(t.db, person.id);
  }
  return KEEPER_ID;
}
