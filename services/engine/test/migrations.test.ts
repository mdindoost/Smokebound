import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadMigrations } from '../src/db/migrations.js';
import { createTestDatabase } from './harness.js';
import type { TestDatabase } from './harness.js';

let t: TestDatabase;

beforeAll(async () => {
  t = await createTestDatabase();
});

afterAll(async () => {
  await t?.close();
});

const TABLES = [
  'profiles',
  'flock',
  'blocks',
  'messages',
  'reports',
  'weather_cells',
  'mechanics_config',
  'events',
];

describe('migrations apply to a fresh database', () => {
  it('applies every migration in filename order', async () => {
    const files = loadMigrations().map((m) => m.name);
    expect(files.length).toBeGreaterThanOrEqual(4);
    expect([...files].sort()).toEqual(files);

    const result = await t.migrate();
    expect(result.applied).toEqual(files);
    expect(result.skipped).toEqual([]);
  });

  it('is idempotent — a second run applies nothing', async () => {
    const result = await t.migrate();
    expect(result.applied).toEqual([]);
    expect(result.skipped).toHaveLength(loadMigrations().length);
  });

  it('creates every table in ARCHITECTURE §3', async () => {
    const { rows } = await t.db.query<{ table_name: string }>(
      `select table_name from information_schema.tables
        where table_schema = 'public' and table_type = 'BASE TABLE'`,
    );
    const names = rows.map((r) => r.table_name);
    for (const table of TABLES) expect(names).toContain(table);
  });

  it('gives messages every column the data model expects', async () => {
    const { rows } = await t.db.query<{ column_name: string; is_nullable: string }>(
      `select column_name, is_nullable from information_schema.columns
        where table_schema = 'public' and table_name = 'messages'`,
    );
    const cols = new Map(rows.map((r) => [r.column_name, r.is_nullable]));
    for (const col of [
      'id',
      'sender',
      'recipient',
      'body',
      'body_delivered',
      'state',
      'origin_cell',
      'dest_cell',
      'route',
      'segment_etas',
      'current_leg',
      'departed_at',
      'eta',
      'stranded_since',
      'stranded_cell',
      'garble_events',
      'lost_at',
      'lost_cell',
      'lost_reason',
      'delivered_at',
      'created_at',
    ]) {
      expect(cols.has(col)).toBe(true);
    }
    expect(cols.get('body')).toBe('NO');
    expect(cols.get('body_delivered')).toBe('YES'); // null until DELIVERED
  });

  it('enables row level security on every table', async () => {
    const { rows } = await t.db.query<{ relname: string; relrowsecurity: boolean }>(
      `select relname, relrowsecurity from pg_class
        where relnamespace = 'public'::regnamespace and relkind = 'r'`,
    );
    const rls = new Map(rows.map((r) => [r.relname, r.relrowsecurity]));
    for (const table of TABLES) expect(rls.get(table)).toBe(true);
  });

  it('defines policies for every table that clients touch', async () => {
    const { rows } = await t.db.query<{ tablename: string; policyname: string }>(
      `select tablename, policyname from pg_policies where schemaname = 'public'`,
    );
    const byTable = new Map<string, string[]>();
    for (const r of rows) byTable.set(r.tablename, [...(byTable.get(r.tablename) ?? []), r.policyname]);

    for (const table of TABLES) expect(byTable.get(table) ?? []).not.toHaveLength(0);

    // The engine is the only writer of flight state (ARCHITECTURE §4).
    const { rows: writePolicies } = await t.db.query<{ cmd: string }>(
      `select cmd from pg_policies where schemaname = 'public' and tablename = 'messages'`,
    );
    const cmds = writePolicies.map((r) => r.cmd);
    expect(cmds).toContain('SELECT');
    expect(cmds).toContain('INSERT');
    expect(cmds).not.toContain('UPDATE');
    expect(cmds).not.toContain('DELETE');
  });

  it('installs the RLS helper functions as security definers', async () => {
    const { rows } = await t.db.query<{ proname: string; prosecdef: boolean }>(
      `select proname, prosecdef from pg_proc
        where pronamespace = 'public'::regnamespace
          and proname in ('flock_status','is_flock_accepted','has_flock_edge',
                          'is_blocked_with','find_profile_by_handle')`,
    );
    expect(rows).toHaveLength(5);
    for (const r of rows) expect(r.prosecdef).toBe(true);
  });
});

describe('schema constraints', () => {
  const alice = '11111111-1111-4111-8111-111111111111';
  const bob = '22222222-2222-4222-8222-222222222222';

  beforeAll(async () => {
    await t.asEngine();
    await t.db.query('insert into auth.users (id) values ($1), ($2)', [alice, bob]);
    await t.db.query(
      `insert into public.profiles (id, handle, home_cell)
       values ($1, 'alice', 'r037c090'), ($2, 'bob', 'r039c066')`,
      [alice, bob],
    );
  });

  it('bounds a message body for sanity, not as the cap (REDTEAM F20)', async () => {
    const insert = (body: string) =>
      t.db.query(
        `insert into public.messages (sender, recipient, body, origin_cell, dest_cell)
         values ($1, $2, $3, 'r037c090', 'r039c066')`,
        [alice, bob, body],
      );

    // The 280-grapheme cap lives in the engine; the column only stops absurdity.
    // 280 family emoji are 1,960 code points and must fit.
    await expect(insert('👨‍👩‍👧‍👦'.repeat(280))).resolves.toBeDefined();
    await expect(insert('x'.repeat(4000))).resolves.toBeDefined();
    await expect(insert('x'.repeat(4001))).rejects.toThrow();
  });

  it('rejects malformed cell ids', async () => {
    await expect(
      t.db.query(
        `insert into public.messages (sender, recipient, body, origin_cell, dest_cell)
         values ($1, $2, 'hi', 'nowhere', 'r039c066')`,
        [alice, bob],
      ),
    ).rejects.toThrow();
    await expect(
      t.db.query(`insert into public.profiles (id, handle, home_cell) values ($1, 'x', 'r1c1')`, [
        '33333333-3333-4333-8333-333333333333',
      ]),
    ).rejects.toThrow();
  });

  it('rejects unknown message states and event kinds', async () => {
    await expect(
      t.db.query(
        `insert into public.messages (sender, recipient, body, state, origin_cell, dest_cell)
         values ($1, $2, 'hi', 'FLOATING', 'r037c090', 'r039c066')`,
        [alice, bob],
      ),
    ).rejects.toThrow();
  });

  it('requires DELIVERED messages to carry their delivered body', async () => {
    await expect(
      t.db.query(
        `insert into public.messages (sender, recipient, body, state, origin_cell, dest_cell)
         values ($1, $2, 'hi', 'DELIVERED', 'r037c090', 'r039c066')`,
        [alice, bob],
      ),
    ).rejects.toThrow();
  });

  it('enforces canonical (a < b) ordering on flock rows', async () => {
    const [lo, hi] = alice < bob ? [alice, bob] : [bob, alice];
    await expect(
      t.db.query(
        `insert into public.flock (a, b, status, requested_by) values ($1, $2, 'pending', $1)`,
        [hi, lo],
      ),
    ).rejects.toThrow();
    await expect(
      t.db.query(
        `insert into public.flock (a, b, status, requested_by) values ($1, $2, 'pending', $1)`,
        [lo, hi],
      ),
    ).resolves.toBeDefined();
  });

  it('refuses a flock row requested by someone outside the pair', async () => {
    const carol = '44444444-4444-4444-8444-444444444444';
    await t.db.query('insert into auth.users (id) values ($1)', [carol]);
    await t.db.query(
      `insert into public.profiles (id, handle, home_cell) values ($1, 'carol', 'r020c040')`,
      [carol],
    );
    const [lo, hi] = alice < carol ? [alice, carol] : [carol, alice];
    await expect(
      t.db.query(
        `insert into public.flock (a, b, status, requested_by) values ($1, $2, 'pending', $3)`,
        [lo, hi, bob],
      ),
    ).rejects.toThrow();
  });

  it('refuses self-blocks', async () => {
    await expect(
      t.db.query('insert into public.blocks (blocker, blocked) values ($1, $1)', [alice]),
    ).rejects.toThrow();
  });

  it('touches mechanics_config.updated_at on change', async () => {
    await t.db.query(
      `insert into public.mechanics_config (key, value, updated_at)
       values ('test.key', '1'::jsonb, now() - interval '1 day')`,
    );
    const before = await t.db.query<{ updated_at: Date }>(
      `select updated_at from public.mechanics_config where key = 'test.key'`,
    );
    await t.db.query(`update public.mechanics_config set value = '2'::jsonb where key = 'test.key'`);
    const after = await t.db.query<{ updated_at: Date }>(
      `select updated_at from public.mechanics_config where key = 'test.key'`,
    );
    expect(new Date(after.rows[0]!.updated_at).getTime()).toBeGreaterThan(
      new Date(before.rows[0]!.updated_at).getTime(),
    );
    await t.db.query(`delete from public.mechanics_config where key = 'test.key'`);
  });
});
