/**
 * @smoke/engine — routing + jobs service.
 *
 * M1 ships the database plumbing only: migrations and `mechanics_config`
 * seeding. The weather cache, A* router and crons arrive in M2/M3
 * (ARCHITECTURE §6, §10).
 */

export { applyMigrations, loadMigrations, MIGRATIONS_DIR, LOCAL_STUBS_DIR } from './db/migrations.js';
export type { Migration, MigrationResult } from './db/migrations.js';
export { pgExecutor } from './db/executor.js';
export type { PgLikeClient, QueryResult, SqlExecutor } from './db/executor.js';
export { seedMechanicsConfig } from './seed/mechanics.js';
export type { SeedOptions, SeedResult } from './seed/mechanics.js';
