/**
 * Seeds `mechanics_config` from `@smoke/shared`'s MECHANICS.md transcription.
 *
 * ARCHITECTURE §10 makes this the only path a gameplay number may take into the
 * running system: MECHANICS.md → `packages/shared/src/mechanics/defaults.ts` →
 * this seed → `mechanics_config` → `MechanicsConfig` at runtime.
 *
 * The seed finishes by reading the table back through the strict loader, so a
 * successful run is proof the config the engine will boot with is complete and
 * type-correct — not just that some rows were written.
 */

import {
  MECHANICS_KEYS,
  MechanicsConfig,
  assertGridMatchesConfig,
  mechanicsSeedRows,
} from '@smoke/shared';
import type { MechanicsConfigRow } from '@smoke/shared';

import type { SqlExecutor } from '../db/executor.js';

export interface SeedOptions {
  /** Delete rows whose key is no longer in MECHANICS.md. Default: false (report only). */
  prune?: boolean;
  log?: (msg: string) => void;
}

export interface SeedResult {
  inserted: string[];
  updated: string[];
  unchanged: string[];
  /** Keys present in the table but unknown to this build. */
  extra: string[];
  pruned: string[];
  config: MechanicsConfig;
}

const UPSERT_SQL = `
insert into public.mechanics_config (key, value)
values ($1, $2::jsonb)
on conflict (key) do update
   set value = excluded.value
 where public.mechanics_config.value is distinct from excluded.value
returning (xmax = 0) as inserted
`;

export async function seedMechanicsConfig(
  db: SqlExecutor,
  options: SeedOptions = {},
): Promise<SeedResult> {
  const log = options.log ?? (() => {});
  const rows = mechanicsSeedRows();

  const inserted: string[] = [];
  const updated: string[] = [];
  const unchanged: string[] = [];

  for (const row of rows) {
    const result = await db.query<{ inserted: boolean }>(UPSERT_SQL, [
      row.key,
      JSON.stringify(row.value),
    ]);
    const touched = result.rows[0];
    if (!touched) unchanged.push(row.key);
    else if (touched.inserted) inserted.push(row.key);
    else updated.push(row.key);
  }

  const { rows: stored } = await db.query<MechanicsConfigRow>(
    'select key, value from public.mechanics_config',
  );

  const known = new Set<string>(MECHANICS_KEYS);
  const extra = stored.map((r) => r.key).filter((k) => !known.has(k));
  const pruned: string[] = [];

  if (options.prune) {
    for (const key of extra) {
      await db.query('delete from public.mechanics_config where key = $1', [key]);
      pruned.push(key);
    }
  }

  // Read back through the strict loader: a seed that cannot be loaded is a
  // failed seed, however many rows it wrote.
  const config = MechanicsConfig.fromRows(stored);
  assertGridMatchesConfig(config);

  log(
    `mechanics_config: ${inserted.length} inserted, ${updated.length} updated, ` +
      `${unchanged.length} unchanged, ${extra.length} unknown` +
      (options.prune ? ` (${pruned.length} pruned)` : ''),
  );

  return { inserted, updated, unchanged, extra, pruned, config };
}
