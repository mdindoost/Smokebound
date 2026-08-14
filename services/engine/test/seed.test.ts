/**
 * The seed is the only channel a gameplay number may take into the database
 * (ARCHITECTURE §10), so it gets tested like production code.
 */

import { MECHANICS_DEFAULTS, MECHANICS_KEYS, MechanicsConfig } from '@smoke/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { seedMechanicsConfig } from '../src/seed/mechanics.js';
import { createTestDatabase } from './harness.js';
import type { TestDatabase } from './harness.js';

let t: TestDatabase;

beforeAll(async () => {
  t = await createTestDatabase();
  await t.migrate();
});

afterAll(async () => {
  await t?.close();
});

describe('seedMechanicsConfig', () => {
  it('inserts every MECHANICS.md key on a fresh database', async () => {
    const result = await seedMechanicsConfig(t.db);
    expect(result.inserted.sort()).toEqual([...MECHANICS_KEYS].sort());
    expect(result.updated).toEqual([]);
    expect(result.extra).toEqual([]);

    const { rows } = await t.db.query<{ count: string }>(
      'select count(*)::text as count from public.mechanics_config',
    );
    expect(Number(rows[0]!.count)).toBe(MECHANICS_KEYS.length);
  });

  it('stores values as jsonb that round-trips to the exact defaults', async () => {
    const { rows } = await t.db.query<{ key: string; value: unknown }>(
      'select key, value from public.mechanics_config',
    );
    const config = MechanicsConfig.fromRows(rows);
    expect(config.toJSON()).toEqual(MECHANICS_DEFAULTS);
    // Nested objects survive the jsonb round trip.
    expect(config.get('weather.time_mult').thunderstorm).toBe(
      MECHANICS_DEFAULTS['weather.time_mult'].thunderstorm,
    );
    expect(config.get('grid.bbox')).toEqual(MECHANICS_DEFAULTS['grid.bbox']);
  });

  it('is idempotent — a second run changes nothing', async () => {
    const result = await seedMechanicsConfig(t.db);
    expect(result.inserted).toEqual([]);
    expect(result.updated).toEqual([]);
    expect(result.unchanged.sort()).toEqual([...MECHANICS_KEYS].sort());
  });

  it('leaves updated_at alone for untouched keys', async () => {
    const stamp = async () =>
      (
        await t.db.query<{ updated_at: string }>(
          `select updated_at from public.mechanics_config where key = 'speed.base_mph'`,
        )
      ).rows[0]!.updated_at;

    const before = await stamp();
    await seedMechanicsConfig(t.db);
    expect(await stamp()).toEqual(before);
  });

  it('repairs a value someone tuned by hand into an invalid one', async () => {
    await t.db.query(
      `update public.mechanics_config set value = '"very fast"'::jsonb where key = 'speed.base_kmh'`,
    );
    const result = await seedMechanicsConfig(t.db);
    expect(result.updated).toEqual(['speed.base_kmh']);
    expect(result.inserted).toEqual([]);
  });

  it('restores a deleted key', async () => {
    await t.db.query(`delete from public.mechanics_config where key = 'garble.gale_chance'`);
    const result = await seedMechanicsConfig(t.db);
    expect(result.inserted).toEqual(['garble.gale_chance']);
  });

  it('reports keys the build no longer knows about, and prunes on request', async () => {
    await t.db.query(
      `insert into public.mechanics_config (key, value) values ('legacy.pigeon_speed', '45'::jsonb)`,
    );
    const reported = await seedMechanicsConfig(t.db);
    expect(reported.extra).toEqual(['legacy.pigeon_speed']);
    expect(reported.pruned).toEqual([]);

    const pruned = await seedMechanicsConfig(t.db, { prune: true });
    expect(pruned.pruned).toEqual(['legacy.pigeon_speed']);

    const { rows } = await t.db.query<{ key: string }>(
      `select key from public.mechanics_config where key = 'legacy.pigeon_speed'`,
    );
    expect(rows).toHaveLength(0);
  });

  it('fails loudly rather than seeding a config the engine cannot boot with', async () => {
    // Simulate a partially-applied seed by dropping a key mid-flight: the strict
    // read-back is what turns that into an error.
    const brokenDb = {
      exec: t.db.exec,
      query: async <Row>(sql: string, params?: unknown[]) => {
        const result = await t.db.query<Row>(sql, params);
        if (sql.includes('select key, value from public.mechanics_config')) {
          return { rows: (result.rows as { key: string }[]).filter(
            (r) => r.key !== 'speed.base_mph',
          ) as Row[] };
        }
        return result;
      },
    };
    await expect(seedMechanicsConfig(brokenDb)).rejects.toThrow(/speed\.base_mph/);
  });

  it('produces a config whose grid matches the compiled cell math', async () => {
    const result = await seedMechanicsConfig(t.db);
    expect(result.config.get('grid.cell_km')).toBe(MECHANICS_DEFAULTS['grid.cell_km']);
    // assertGridMatchesConfig already ran inside the seed; reaching here proves it passed.
  });
});
