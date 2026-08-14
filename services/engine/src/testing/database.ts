/**
 * In-process Postgres (PGlite) for tests — the engine's own, and the mobile
 * app's two-client end-to-end run.
 *
 * This is real Postgres compiled to WASM, so `create policy`, `security definer`
 * functions and `set role` all behave as they will on Supabase. The only thing
 * we have to supply ourselves is what Supabase pre-installs: the `auth` schema
 * and the anon / authenticated / service_role roles
 * (see `supabase/local/00_supabase_stubs.sql`).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';

import { LOCAL_STUBS_DIR, applyMigrations } from '../db/migrations.js';
import type { MigrationResult } from '../db/migrations.js';
import type { QueryResult, SqlExecutor } from '../db/executor.js';

export type SupabaseRole = 'authenticated' | 'anon' | 'service_role';

export interface TestDatabase {
  db: SqlExecutor;
  pg: PGlite;
  /** Apply `supabase/migrations` on top of the local stubs. */
  migrate: () => Promise<MigrationResult>;
  /** Become a signed-in user (or a signed-out visitor when `userId` is null). */
  as: (userId: string | null, role?: SupabaseRole) => Promise<void>;
  /** Drop back to the owner role — stands in for the engine's service_role key. */
  asEngine: () => Promise<void>;
  close: () => Promise<void>;
}

export async function createTestDatabase(): Promise<TestDatabase> {
  const pg = await PGlite.create();

  const db: SqlExecutor = {
    async exec(sql: string): Promise<void> {
      await pg.exec(sql);
    },
    async query<Row>(sql: string, params: unknown[] = []): Promise<QueryResult<Row>> {
      const result = await pg.query<Row>(sql, params);
      return { rows: result.rows };
    },
  };

  // Everything Supabase would already have in place.
  await pg.exec(readFileSync(join(LOCAL_STUBS_DIR, '00_supabase_stubs.sql'), 'utf8'));

  const asEngine = async (): Promise<void> => {
    await pg.exec('reset role');
    await pg.query("select set_config('request.jwt.claims', '', false)");
  };

  const as = async (userId: string | null, role: SupabaseRole = 'authenticated'): Promise<void> => {
    await pg.exec('reset role');
    await pg.query("select set_config('request.jwt.claims', $1, false)", [
      userId === null ? '' : JSON.stringify({ sub: userId }),
    ]);
    await pg.exec(`set role ${role}`);
  };

  return {
    db,
    pg,
    migrate: () => applyMigrations(db),
    as,
    asEngine,
    close: () => pg.close(),
  };
}

/** Create an auth user + profile as the engine would at onboarding. */
export async function createUser(
  t: TestDatabase,
  id: string,
  handle: string,
  homeCell: string,
): Promise<void> {
  await t.asEngine();
  await t.db.query('insert into auth.users (id) values ($1)', [id]);
  await t.db.query(
    'insert into public.profiles (id, handle, home_cell) values ($1, $2, $3)',
    [id, handle, homeCell],
  );
}

/** Create a flock edge in canonical (a < b) order. */
export async function createFlock(
  t: TestDatabase,
  x: string,
  y: string,
  status: 'pending' | 'accepted',
  requestedBy: string,
): Promise<void> {
  const [a, b] = x < y ? [x, y] : [y, x];
  await t.asEngine();
  await t.db.query(
    'insert into public.flock (a, b, status, requested_by) values ($1, $2, $3, $4)',
    [a, b, status, requestedBy],
  );
}
