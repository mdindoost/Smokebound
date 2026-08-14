/**
 * `SqlWeatherStore` against the real `weather_cells` table (PGlite), so the
 * cache's persistence is verified against the migration rather than a mock.
 */

import { MECHANICS_DEFAULTS, formatCellId } from '@smoke/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { SqlWeatherStore } from '../../src/weather/store.js';
import type { StoredWeather } from '../../src/weather/store.js';
import { createTestDatabase } from '../harness.js';
import type { TestDatabase } from '../harness.js';
import { CELLS } from '../fixtures/weather.js';

let t: TestDatabase;
let store: SqlWeatherStore;

const FETCHED_AT = new Date('2026-08-14T12:00:00.000Z');

function row(patch: Partial<StoredWeather> = {}): StoredWeather {
  return {
    cell: CELLS.newark,
    condition: 'thunderstorm',
    windMph: 42.4,
    windDirFromDeg: 247.5,
    timeMult: MECHANICS_DEFAULTS['weather.time_mult'].thunderstorm,
    impassable: false,
    weatherUnknown: false,
    fetchedAt: FETCHED_AT,
    ...patch,
  };
}

beforeAll(async () => {
  t = await createTestDatabase();
  await t.migrate();
  store = new SqlWeatherStore(t.db);
});

afterAll(async () => {
  await t?.close();
});

describe('SqlWeatherStore', () => {
  it('round-trips a cell through the table', async () => {
    await store.write([row()]);
    const read = await store.read([CELLS.newark]);
    const stored = read.get(CELLS.newark)!;

    expect(stored.condition).toBe('thunderstorm');
    expect(stored.timeMult).toBe(MECHANICS_DEFAULTS['weather.time_mult'].thunderstorm);
    expect(stored.impassable).toBe(false);
    expect(stored.weatherUnknown).toBe(false);
    expect(stored.fetchedAt.toISOString()).toBe(FETCHED_AT.toISOString());
    // wind is stored as integer degrees/mph, per the schema
    expect(stored.windMph).toBe(42);
    expect(stored.windDirFromDeg).toBe(248);
  });

  it('upserts rather than duplicating', async () => {
    await store.write([row({ condition: 'clear', timeMult: 1, impassable: false })]);
    await store.write([row({ condition: 'snow', timeMult: 2.5, impassable: true })]);

    const stored = (await store.read([CELLS.newark])).get(CELLS.newark)!;
    expect(stored.condition).toBe('snow');
    expect(stored.impassable).toBe(true);

    const { rows } = await t.db.query<{ count: string }>(
      `select count(*)::text as count from public.weather_cells where cell = $1`,
      [CELLS.newark],
    );
    expect(Number(rows[0]!.count)).toBe(1);
  });

  it('returns nothing for cells it has never seen', async () => {
    const read = await store.read([formatCellId({ row: 50, col: 5 })]);
    expect(read.size).toBe(0);
  });

  it('handles an empty request without touching the database', async () => {
    expect((await store.read([])).size).toBe(0);
  });

  it('keeps the weather_unknown flag, which is the fail-open audit trail', async () => {
    const cell = CELLS.chicago;
    await store.write([
      row({ cell, condition: 'unknown', timeMult: 1, weatherUnknown: true, windMph: 0, windDirFromDeg: 0 }),
    ]);
    const stored = (await store.read([cell])).get(cell)!;
    expect(stored.weatherUnknown).toBe(true);
    expect(stored.condition).toBe('unknown');
  });

  it('reads many cells in one query', async () => {
    const cells = [CELLS.newark, CELLS.chicago, CELLS.miami];
    await store.write(cells.map((cell) => row({ cell })));
    const read = await store.read(cells);
    expect([...read.keys()].sort()).toEqual([...cells].sort());
  });
});
