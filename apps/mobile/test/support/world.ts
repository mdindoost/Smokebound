/**
 * A whole SMOKE, in a test: real migrations, real RLS, the real engine, the real
 * router, and two clients that only ever touch the `DataGateway` the screens
 * use.
 *
 * The config is shortened — a test speed multiplier — so a Newark→Chicago flight
 * takes minutes of simulated time instead of a day and a half. Everything else
 * is the shipped configuration.
 */

import {
  MechanicsConfig,
  cellId,
  mechanicsSeedRows,
} from '@smoke/shared';
import {
  MemoryWeatherStore,
  RecordingPushDispatcher,
  WeatherCache,
  createEngineContext,
  createTestDatabase,
  createTestFlock,
  createTestUser,
  drainEngineRequests,
  ensureKeeper,
  runDeliveryCheck,
  runDissipation,
  runKeeperReplies,
  runReplan,
  seedMechanicsConfig,
  KEEPER_ID,
} from '@smoke/engine';
import type { EngineContext, NwsAlert, NwsClient, NwsForecast, TestDatabase } from '@smoke/engine';
import type { LatLng } from '@smoke/shared';

import { PgGateway, PolledTableTransport } from './pgGateway';
import type { SqlRunner } from './pgGateway';
import type { DataGateway } from '../../src/lib/gateway';

/** Smoke moves 100× faster in the tests, so a flight is minutes, not days. */
export const TEST_SPEED_MULTIPLIER = 100;

export const START = new Date('2026-08-14T12:00:00.000Z');

export const ALICE = '11111111-1111-4111-8111-111111111111';
export const BOB = '22222222-2222-4222-8222-222222222222';
export const NEWARK = cellId({ lat: 40.7357, lng: -74.1724 });
export const CHICAGO = cellId({ lat: 41.8781, lng: -87.6298 });

class TestClock {
  constructor(private current: Date) {}
  now(): Date {
    return new Date(this.current);
  }
  advanceMinutes(minutes: number): void {
    this.current = new Date(this.current.getTime() + minutes * 60_000);
  }
  advanceSeconds(seconds: number): void {
    this.current = new Date(this.current.getTime() + seconds * 1000);
  }
}

class ScriptedNws implements NwsClient {
  private readonly forecasts = new Map<string, NwsForecast>();
  alerts: NwsAlert[] = [];

  setForecast(cells: readonly string[], forecast: Partial<NwsForecast>): void {
    for (const cell of cells) {
      this.forecasts.set(cell, {
        shortForecast: 'Sunny',
        windSpeed: '0 mph',
        windDirection: 'W',
        ...forecast,
      });
    }
  }

  async getForecast(point: LatLng): Promise<NwsForecast | null> {
    return (
      this.forecasts.get(cellId(point)) ?? {
        shortForecast: 'Sunny',
        windSpeed: '0 mph',
        windDirection: 'W',
      }
    );
  }

  async getHourlyForecast(): Promise<null> {
    // The mobile world exercises the client, not counsel; nothing here reads
    // hourly forecasts.
    return null;
  }

  async getActiveAlerts(): Promise<NwsAlert[]> {
    return this.alerts;
  }
}

export interface World {
  db: TestDatabase;
  ctx: EngineContext;
  clock: TestClock;
  nws: ScriptedNws;
  push: RecordingPushDispatcher;
  alice: DataGateway;
  bob: DataGateway;
  gatewayFor(userId: string): DataGateway;
  /**
   * Run the cron set. One `pass` is one scheduler minute — and a message never
   * departs *and* arrives inside a single pass, so the default is two.
   */
  tick(passes?: number): Promise<void>;
  close(): Promise<void>;
}

export async function createWorld(): Promise<World> {
  const db = await createTestDatabase();
  await db.migrate();

  // Shortened config: everything as shipped, except the speed.
  const rows = mechanicsSeedRows().map((row) =>
    row.key === 'speed.base_kmh'
      ? { key: row.key, value: (row.value as number) * TEST_SPEED_MULTIPLIER }
      : row,
  );
  await db.asEngine();
  for (const row of rows) {
    await db.db.query(
      `insert into public.mechanics_config (key, value) values ($1, $2::jsonb)
       on conflict (key) do update set value = excluded.value`,
      [row.key, JSON.stringify(row.value)],
    );
  }
  const config = MechanicsConfig.fromRows(rows);

  const clock = new TestClock(START);
  const nws = new ScriptedNws();
  const push = new RecordingPushDispatcher();

  const weather = new WeatherCache({
    client: nws,
    store: new MemoryWeatherStore(),
    config,
    now: () => clock.now(),
    random: () => 0.5,
    sleep: async () => {},
    jitterMs: 0,
    concurrency: 8,
  });

  const ctx = createEngineContext({
    db: db.db,
    config,
    weather,
    push,
    clock,
    previewSecret: 'e2e-preview-secret',
    keeperId: KEEPER_ID,
  });

  await ensureKeeper(db.db, cellId({ lat: 39.0997, lng: -94.5786 }));

  // Two people with fires, flocked to each other. Onboarding proper is the
  // screens' job; here we only need the world to exist.
  await createTestUser(db, ALICE, 'alice', NEWARK);
  await createTestUser(db, BOB, 'bob', CHICAGO);
  await createTestFlock(db, ALICE, BOB, 'accepted', ALICE);

  const sql: SqlRunner = {
    async asUser<Row>(userId: string, query: string, params: unknown[] = []): Promise<Row[]> {
      await db.as(userId);
      const { rows } = await db.db.query<Row>(query, params);
      return rows;
    },
    async asEngine<Row>(query: string, params: unknown[] = []): Promise<Row[]> {
      await db.asEngine();
      const { rows } = await db.db.query<Row>(query, params);
      return rows;
    },
  };

  const drain = async (): Promise<void> => {
    await db.asEngine();
    await drainEngineRequests(ctx);
  };

  const gatewayFor = (userId: string): DataGateway =>
    new PgGateway(userId, sql, new PolledTableTransport(userId, sql, drain));

  const tick = async (passes = 2): Promise<void> => {
    for (let pass = 0; pass < passes; pass++) {
      await db.asEngine();
      await runDeliveryCheck(ctx);
      await runReplan(ctx);
      await runDissipation(ctx);
      await runKeeperReplies(ctx);
    }
  };

  // Config is seeded through the engine's own seeder too, so the strict loader
  // has verified it — then the speed override is re-applied on top.
  await db.asEngine();
  await seedMechanicsConfig(ctx.db);
  await ctx.db.query(
    `update public.mechanics_config set value = $1::jsonb where key = 'speed.base_kmh'`,
    [JSON.stringify(config.get('speed.base_kmh'))],
  );

  return {
    db,
    ctx,
    clock,
    nws,
    push,
    alice: gatewayFor(ALICE),
    bob: gatewayFor(BOB),
    gatewayFor,
    tick,
    close: () => db.close(),
  };
}
