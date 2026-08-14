/**
 * Seed `mechanics_config` with every number from MECHANICS.md.
 *
 *   npm run db:seed                    # from the repo root
 *   npm run seed -w services/engine -- --prune
 *
 * Idempotent: re-running only rewrites keys whose value actually changed, so
 * `updated_at` stays meaningful as a "when did we last tune this" record.
 * `--prune` also deletes keys this build no longer knows about.
 */

import { cellId } from '@smoke/shared';

import { seedMechanicsConfig } from '../src/seed/mechanics.js';
import { ensureKeeper, KEEPER_HANDLE } from '../src/messages/keeper.js';
import { connect } from './db.js';

const prune = process.argv.includes('--prune');
const withKeeper = process.argv.includes('--keeper');
const { db, close, target } = await connect();

try {
  console.log(`Seeding mechanics_config in ${target}`);
  const result = await seedMechanicsConfig(db, { prune, log: (msg) => console.log(msg) });

  if (result.inserted.length) console.log(`  inserted: ${result.inserted.join(', ')}`);
  if (result.updated.length) console.log(`  updated:  ${result.updated.join(', ')}`);
  if (result.extra.length && !prune) {
    console.log(
      `  note: ${result.extra.length} key(s) in the table are unknown to this build ` +
        `(${result.extra.join(', ')}). Re-run with --prune to remove them.`,
    );
  }
  console.log('mechanics_config loads cleanly through the strict config loader.');

  if (withKeeper) {
    // Kansas City: a placeholder address. The Keeper's real position is computed
    // per user, one cell from theirs (REDTEAM F5).
    await ensureKeeper(db, cellId({ lat: 39.0997, lng: -94.5786 }));
    console.log(`The Keeper (@${KEEPER_HANDLE}) and its flavour lines are seeded.`);
  }
} finally {
  await close();
}
