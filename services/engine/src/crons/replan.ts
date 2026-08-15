/**
 * replan — every 15 minutes (ARCHITECTURE §6.3, MECHANICS §4).
 *
 * Commit-with-replan-on-block: a route is committed at send and followed, but
 * every cycle we check whether the *next* cell has become impassable. If it has,
 * the smoke shelters at the storm edge (STRANDED, with a push — this is the
 * drama the product is made of). Stranded messages, including ones that never
 * left their origin (REDTEAM F17), get a fresh routing attempt each cycle.
 */

import type { CellId, Message } from '@smoke/shared';

import { addHours } from '../engine/clock.js';
import type { EngineContext } from '../engine/context.js';
import { messagesInStates, recordEvent, updateMessage } from '../db/repo.js';
import { replanFrom } from '../messages/planning.js';
import { planRoute, toSegmentEtas } from '../routing/astar.js';

export interface ReplanStats {
  checked: number;
  stranded: number;
  resumed: number;
  stillStranded: number;
}

export async function runReplan(ctx: EngineContext): Promise<ReplanStats> {
  const now = ctx.clock.now();
  const stats: ReplanStats = { checked: 0, stranded: 0, resumed: 0, stillStranded: 0 };

  for (const message of await messagesInStates(ctx.db, ['IN_FLIGHT', 'STRANDED'])) {
    stats.checked++;
    if (message.state === 'IN_FLIGHT') await checkAhead(ctx, message, now, stats);
    else await tryToResume(ctx, message, now, stats);
  }

  return stats;
}

/** Is the next cell on the committed route still passable? */
async function checkAhead(
  ctx: EngineContext,
  message: Message,
  now: Date,
  stats: ReplanStats,
): Promise<void> {
  const route: CellId[] = Array.isArray(message.route) ? message.route : [];
  const here = route[message.current_leg];
  const next = route[message.current_leg + 1];
  if (!here || !next) return; // already at the destination; delivery-check owns that

  const weather = await ctx.weather.getCellWeather([here, next]);
  const blocked = weather.get(next)?.impassable === true;
  if (!blocked) return;

  await updateMessage(ctx.db, message.id, {
    state: 'STRANDED',
    strandedSince: now,
    strandedCell: here,
  });
  await recordEvent(ctx.db, message.id, 'STRANDED', {
    cell: here,
    blocked_cell: next,
    at_origin: here === message.origin_cell,
  }, now);
  await ctx.push.dispatch({
    userId: message.sender,
    kind: 'STRANDED',
    title: 'Your signal is sheltering',
    body: 'A storm has closed the way ahead. Your smoke is waiting at its edge.',
    data: { message_id: message.id, cell: here, blocked_cell: next },
  });
  stats.stranded++;
}

/** Can a stranded message get moving again? */
async function tryToResume(
  ctx: EngineContext,
  message: Message,
  now: Date,
  stats: ReplanStats,
): Promise<void> {
  const from = message.stranded_cell ?? message.origin_cell;
  const journey = await replanFrom(ctx, from, message.dest_cell);

  if (journey.result.status !== 'OK') {
    stats.stillStranded++;
    return;
  }

  // The next cell has to be genuinely open, not merely cheapest.
  const nextCell = journey.result.route[1];
  if (nextCell && journey.weather.get(nextCell)?.impassable === true) {
    stats.stillStranded++;
    return;
  }

  const waypoints = journey.result.waypoints;
  const segmentEtas = toSegmentEtas(waypoints, now);
  const eta = addHours(now, journey.result.totalHours);

  await updateMessage(ctx.db, message.id, {
    state: 'IN_FLIGHT',
    route: journey.result.route,
    segmentEtas,
    currentLeg: 0,
    eta,
    strandedSince: null,
  });
  await recordEvent(ctx.db, message.id, 'RESUMED', {
    cell: from,
    total_hours: journey.result.totalHours,
    eta: eta.toISOString(),
  }, now);
  await ctx.push.dispatch({
    userId: message.sender,
    kind: 'RESUMED',
    title: 'The skies cleared',
    body: 'Your signal is moving again.',
    data: { message_id: message.id, eta: eta.toISOString() },
  });
  stats.resumed++;
}

/** Exposed for tests and diagnostics: what would a replan do right now? */
export async function previewReplan(ctx: EngineContext, message: Message) {
  const from = message.stranded_cell ?? message.route?.[message.current_leg] ?? message.origin_cell;
  const weather = await ctx.weather.getCorridorWeather(from, message.dest_cell);
  return planRoute({ origin: from, dest: message.dest_cell, weather, config: ctx.config });
}
