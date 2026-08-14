/**
 * Apply `supabase/migrations` to the database in DATABASE_URL.
 *
 *   npm run db:migrate -w services/engine
 *
 * Equivalent to `supabase db push` for projects linked to the Supabase CLI;
 * use whichever fits your setup. Both are idempotent.
 */

import { applyMigrations } from '../src/db/migrations.js';
import { connect } from './db.js';

const { db, close, target } = await connect();

try {
  console.log(`Applying migrations to ${target}`);
  const result = await applyMigrations(db, { log: (msg) => console.log(msg) });
  console.log(
    `Done: ${result.applied.length} applied, ${result.skipped.length} already present.`,
  );
} finally {
  await close();
}
