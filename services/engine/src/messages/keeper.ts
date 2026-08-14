/**
 * The Keeper (SPEC §3, ARCHITECTURE §6.3, REDTEAM F5).
 *
 * The first-session dead-air problem: a new user adds one friend in another
 * state, sends, and nothing happens for 36 hours. The Keeper is the fix — a
 * system flock member whose fire is always one cell from yours, so day one
 * always contains a complete send → track → deliver loop.
 *
 * "One cell from yours" is per-user and virtual: there is no single Keeper
 * location. Its `home_cell` in `profiles` is a placeholder; the cell that
 * actually matters is computed from whoever is writing to it.
 */

import { isTraversable, neighbors } from '@smoke/shared';
import type { CellId, Uuid } from '@smoke/shared';

import type { SqlExecutor } from '../db/executor.js';
import { countKeeperLines, countKeeperRepliesTo, keeperLine } from '../db/repo.js';

/** Fixed id so the Keeper survives reseeding and is recognisable in the data. */
export const KEEPER_ID: Uuid = '00000000-0000-4000-8000-00000000f1e5';
export const KEEPER_HANDLE = 'thekeeper';

/**
 * The Keeper's fire for a given user: the first traversable neighbour of their
 * home cell, in the deterministic order `neighbors()` returns. Deterministic
 * matters — the same user must always see the Keeper in the same place.
 */
export function keeperCellFor(userHomeCell: CellId): CellId {
  for (const neighbor of neighbors(userHomeCell)) {
    if (isTraversable(neighbor)) return neighbor;
  }
  // A user whose every neighbour is ocean or border: the Keeper shares their cell.
  // The delivery floor (MECHANICS §7B) still keeps it from being instant.
  return userHomeCell;
}

/** The era-flavoured lines the Keeper answers with (ARCHITECTURE §6.3). */
export const KEEPER_LINES: { line: string; era: string }[] = [
  { line: 'Received. The hills between us are quiet tonight.', era: 'general' },
  { line: 'Your smoke read clearly. Polybius would have needed two torches for that.', era: 'greek' },
  { line: 'Acknowledged from the tower. The next beacon has been lit.', era: 'chinese' },
  { line: 'Good fire. Dry wood carries further than green — remember it.', era: 'craft' },
  { line: 'I saw it rise before I read it. That is how you know the wind is fair.', era: 'craft' },
  { line: 'Message held and kept. The ledger grows.', era: 'general' },
  { line: 'Three puffs, clean edges. Whoever taught you knew their work.', era: 'craft' },
  { line: 'The sky was generous today. It is not always so.', era: 'general' },
  { line: 'Understood. Watch the west — weather is coming in behind your signal.', era: 'general' },
  { line: 'A short message travels furthest. Yours did.', era: 'craft' },
  { line: 'From one fire to another: welcome.', era: 'general' },
  { line: 'Read at dusk, when the smoke shows best against the light.', era: 'craft' },
];

/**
 * Create the Keeper's account if it is missing. Idempotent.
 *
 * This writes an `auth.users` row directly because the Keeper is not a person
 * and will never sign in — it exists only so `profiles` has something to point
 * at. Every other account is created by Supabase Auth.
 */
export async function ensureKeeper(db: SqlExecutor, homeCell: CellId): Promise<Uuid> {
  await db.query(
    `insert into auth.users (id) values ($1) on conflict (id) do nothing`,
    [KEEPER_ID],
  );
  await db.query(
    `insert into public.profiles (id, handle, display_name, home_cell, is_system)
     values ($1, $2, 'The Keeper', $3, true)
     on conflict (id) do update set is_system = true`,
    [KEEPER_ID, KEEPER_HANDLE, homeCell],
  );

  for (const [index, entry] of KEEPER_LINES.entries()) {
    await db.query(
      `insert into public.keeper_lines (id, line, era) values ($1, $2, $3)
       on conflict (id) do update set line = excluded.line, era = excluded.era`,
      [index, entry.line, entry.era],
    );
  }

  return KEEPER_ID;
}

/** Flock the Keeper to a user, accepted from the start (onboarding, M4). */
export async function ensureKeeperFlock(db: SqlExecutor, userId: Uuid): Promise<void> {
  const [a, b] = userId < KEEPER_ID ? [userId, KEEPER_ID] : [KEEPER_ID, userId];
  await db.query(
    `insert into public.flock (a, b, status, requested_by)
     values ($1, $2, 'accepted', $3)
     on conflict (a, b) do update set status = 'accepted'`,
    [a, b, KEEPER_ID],
  );
}

/** The next line for this user, rotating through the table. */
export async function nextKeeperLine(db: SqlExecutor, userId: Uuid): Promise<string> {
  const total = await countKeeperLines(db);
  if (total === 0) return KEEPER_LINES[0]!.line;
  const alreadySent = await countKeeperRepliesTo(db, KEEPER_ID, userId);
  return (await keeperLine(db, alreadySent % total)) ?? KEEPER_LINES[0]!.line;
}
