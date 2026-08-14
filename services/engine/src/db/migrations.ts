/**
 * Migration runner for `supabase/migrations`.
 *
 * The files are plain SQL in the layout the Supabase CLI expects, so
 * `supabase db push` remains the primary path. This runner exists so the same
 * migrations can be applied from CI, from a machine without the CLI, and from
 * the test suite (against PGlite) — one ordering, one applied-list, no drift.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { SqlExecutor } from './executor.js';

const HERE = fileURLToPath(new URL('.', import.meta.url));

/** `<repo>/supabase/migrations` */
export const MIGRATIONS_DIR = join(HERE, '..', '..', '..', '..', 'supabase', 'migrations');

/** `<repo>/supabase/local` — test-harness SQL, never applied to a real project. */
export const LOCAL_STUBS_DIR = join(HERE, '..', '..', '..', '..', 'supabase', 'local');

export interface Migration {
  /** File name, which is also the version key (e.g. `20260814150000_init_schema.sql`). */
  name: string;
  path: string;
  sql: string;
}

export function loadMigrations(dir: string = MIGRATIONS_DIR): Migration[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort() // timestamp-prefixed names sort into application order
    .map((name) => {
      const path = join(dir, name);
      return { name, path, sql: readFileSync(path, 'utf8') };
    });
}

const MIGRATIONS_TABLE_SQL = `
create table if not exists public.schema_migrations (
  version text primary key,
  applied_at timestamptz not null default now()
);
`;

export interface MigrationResult {
  applied: string[];
  skipped: string[];
}

/**
 * Apply every not-yet-applied migration, in filename order, each in its own
 * transaction. Safe to re-run: already-applied versions are skipped.
 */
export async function applyMigrations(
  db: SqlExecutor,
  options: { dir?: string; log?: (msg: string) => void } = {},
): Promise<MigrationResult> {
  const log = options.log ?? (() => {});
  const migrations = loadMigrations(options.dir);

  await db.exec(MIGRATIONS_TABLE_SQL);
  const { rows } = await db.query<{ version: string }>('select version from public.schema_migrations');
  const done = new Set(rows.map((r) => r.version));

  const result: MigrationResult = { applied: [], skipped: [] };

  for (const migration of migrations) {
    if (done.has(migration.name)) {
      result.skipped.push(migration.name);
      log(`· ${migration.name} (already applied)`);
      continue;
    }
    log(`→ ${migration.name}`);
    await db.exec('begin');
    try {
      await db.exec(migration.sql);
      await db.query('insert into public.schema_migrations (version) values ($1)', [migration.name]);
      await db.exec('commit');
    } catch (err) {
      await db.exec('rollback');
      throw new Error(`migration ${migration.name} failed: ${(err as Error).message}`, {
        cause: err,
      });
    }
    result.applied.push(migration.name);
  }

  return result;
}
