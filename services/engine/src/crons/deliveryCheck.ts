/**
 * delivery-check — every minute (ARCHITECTURE §6.3).
 *
 * The only cron that moves smoke forward:
 *   TRANSMITTING → IN_FLIGHT once the fire has finished puffing (MECHANICS §3),
 *                → STRANDED at the origin when there was no route to take (F17)
 *   IN_FLIGHT    → advance `current_leg` past due waypoints, rolling garble in
 *                  every gale cell traversed (MECHANICS §2.2, §6.2)
 *                → DELIVERED at the final eta, materialising `body_delivered`
 *
 * Position is derived, never ticked: the segment ETAs computed at send are the
 * server truth and this cron simply reads the clock against them.
 */

import type { CellId, Message, SegmentEta } from '@smoke/shared';

import type { EngineContext } from '../engine/context.js';
import { rollChance, seededRng } from '../engine/rng.js';
import { messagesInStates, recordEvent, updateMessage } from '../db/repo.js';
import type { GarbleEventRow } from '../db/repo.js';
import { replayGarbles } from '../messages/garbleLog.js';

export interface DeliveryCheckStats {
  departed: number;
  strandedAtOrigin: number;
  advanced: number;
  garbled: number;
  delivered: number;
}

export async function runDeliveryCheck(ctx: EngineContext): Promise<DeliveryCheckStats> {
  const now = ctx.clock.now();
  const stats: DeliveryCheckStats = {
    departed: 0,
    strandedAtOrigin: 0,
    advanced: 0,
    garbled: 0,
    delivered: 0,
  };

  const messages = await messagesInStates(ctx.db, ['TRANSMITTING', 'IN_FLIGHT']);

  for (const message of messages) {
    if (message.state === 'TRANSMITTING') {
      await promoteTransmitting(ctx, message, now, stats);
    } else {
      await advanceInFlight(ctx, message, now, stats);
    }
  }

  return stats;
}

async function promoteTransmitting(
  ctx: EngineContext,
  message: Message,
  now: Date,
  stats: DeliveryCheckStats,
): Promise<void> {
  if (message.departed_at === null) return;
  if (new Date(message.departed_at).getTime() > now.getTime()) return; // still puffing

  const hasRoute = Array.isArray(message.route) && message.route.length >= 2;

  if (!hasRoute) {
    // REDTEAM F17: the send succeeded, the sky did not. It waits at its own fire.
    await updateMessage(ctx.db, message.id, {
      state: 'STRANDED',
      strandedSince: now,
      strandedCell: message.origin_cell,
    });
    await recordEvent(ctx.db, message.id, 'STRANDED', {
      cell: message.origin_cell,
      at_origin: true,
      reason: 'no_route_at_departure',
    });
    await ctx.push.dispatch({
      userId: message.sender,
      kind: 'STRANDED',
      title: 'Your signal is waiting',
      body: 'The sky is closed in every direction. Your smoke is sheltering at home.',
      data: { message_id: message.id, cell: message.origin_cell },
    });
    stats.strandedAtOrigin++;
    return;
  }

  await updateMessage(ctx.db, message.id, { state: 'IN_FLIGHT', currentLeg: 0 });
  await recordEvent(ctx.db, message.id, 'DEPARTED', {
    cell: message.origin_cell,
    eta: message.eta,
  });
  stats.departed++;
}

async function advanceInFlight(
  ctx: EngineContext,
  message: Message,
  now: Date,
  stats: DeliveryCheckStats,
): Promise<void> {
  const segments: SegmentEta[] = Array.isArray(message.segment_etas) ? message.segment_etas : [];
  if (segments.length === 0) return;

  let leg = message.current_leg;
  const traversed: CellId[] = [];

  while (leg + 1 < segments.length) {
    const next = segments[leg + 1]!;
    if (new Date(next.eta).getTime() > now.getTime()) break;
    leg++;
    traversed.push(next.cell);
  }

  const garbleEvents: GarbleEventRow[] = Array.isArray(message.garble_events)
    ? [...(message.garble_events as GarbleEventRow[])]
    : [];

  if (traversed.length > 0) {
    const rolled = await rollGarbles(ctx, message, traversed, now, garbleEvents);
    stats.garbled += rolled;
    stats.advanced++;
  }

  const arrived =
    message.eta !== null && new Date(message.eta).getTime() <= now.getTime() &&
    leg + 1 >= segments.length;

  if (!arrived) {
    if (leg !== message.current_leg || garbleEvents.length !== (message.garble_events?.length ?? 0)) {
      await updateMessage(ctx.db, message.id, { currentLeg: leg, garbleEvents });
    }
    return;
  }

  const { text } = replayGarbles(message.body, garbleEvents, message.id, ctx.config);

  await updateMessage(ctx.db, message.id, {
    state: 'DELIVERED',
    currentLeg: leg,
    garbleEvents,
    bodyDelivered: text,
    deliveredAt: now,
  });
  await recordEvent(ctx.db, message.id, 'DELIVERED', {
    cell: message.dest_cell,
    garble_events: garbleEvents.length,
    wind_damaged: garbleEvents.length > 0,
  });
  await ctx.push.dispatch({
    userId: message.recipient,
    kind: 'DELIVERED',
    title: 'Smoke on the horizon',
    body: garbleEvents.length > 0 ? 'A wind-damaged signal has arrived.' : 'A signal has arrived.',
    data: { message_id: message.id, wind_damaged: garbleEvents.length > 0 },
  });
  stats.delivered++;
}

/**
 * Roll garble once per gale cell traversed (MECHANICS §2.2 gale rule, §6.2).
 * Mutates `garbleEvents`, returns how many rolls landed.
 */
async function rollGarbles(
  ctx: EngineContext,
  message: Message,
  traversed: readonly CellId[],
  now: Date,
  garbleEvents: GarbleEventRow[],
): Promise<number> {
  const weather = await ctx.weather.getCellWeather(traversed);
  const galeThreshold = ctx.config.get('wind.gale_threshold_mph');
  const chance = ctx.config.get('garble.gale_chance');
  let hits = 0;

  for (const cell of traversed) {
    const entry = weather.get(cell);
    if (!entry || entry.windMph <= galeThreshold) continue;

    // Seeded per (message, cell) so the same gale always rolls the same way.
    const rng = seededRng(`${message.id}:gale:${cell}`);
    if (!rollChance(rng, chance)) continue;

    const pending: GarbleEventRow = { cell, at: now.toISOString(), chars_hit: 0 };
    const replay = replayGarbles(message.body, [...garbleEvents, pending], message.id, ctx.config);
    pending.chars_hit = replay.hits.at(-1) ?? 0;
    garbleEvents.push(pending);
    hits++;

    await recordEvent(ctx.db, message.id, 'GARBLED', {
      cell,
      wind_mph: entry.windMph,
      chars_hit: pending.chars_hit,
    });
  }

  return hits;
}
