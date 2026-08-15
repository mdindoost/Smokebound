/**
 * Tower voices (M5.7 §2).
 *
 * A signal crossing the country for three days produced four Ledger lines: sent,
 * departed, delivered, and whatever went wrong. The stations it passed had
 * nothing to say, which is a strange silence in a product whose entire fiction
 * is a chain of people watching for each other's fires.
 *
 * This cron gives them a voice, under three rules that keep it from becoming a
 * feed:
 *
 * **1. Only what cannot be derived.** Sunset and sunrise crossings stay on the
 * client, because given the route, the segment ETAs and the sun they are
 * arithmetic both sides can do. What the engine knows and the client cannot is
 * *change*: the wind got up over Trenton, the fog closed in ahead. That needs
 * two observations at two times, and only the engine has the first one.
 *
 * **2. At most one voice per `narration.min_interval_hours`.** When several
 * things happen inside a window, the most interesting one is kept and the rest
 * are dropped rather than queued. A scroll worth reading is made of the
 * memorable things, not all of them.
 *
 * **3. Weather beats sightings.** A tower reporting that it saw the signal is
 * pleasant; a tower reporting that the wind has got up is the game. So a
 * sighting is what a station says when it has nothing better.
 *
 * **R21 needs nothing here.** `events_select_visible_message` already lets a
 * recipient read events only once the message is DELIVERED, so a tower's voice
 * reaches the sender's Ledger and nowhere else. Narration cannot become a
 * pre-delivery notification even by accident.
 */

import { cellCenter, initialBearingDeg } from '@smoke/shared';
import type { CellId, Message, SegmentEta } from '@smoke/shared';

import type { EngineContext } from '../engine/context.js';
import { messagesInStates, recordEvent } from '../db/repo.js';

export interface NarrationStats {
  considered: number;
  spoke: number;
  /** Held back because the last voice was too recent. */
  throttled: number;
}

/** The narration kinds, most interesting first — the tie-break in rule 3. */
const BY_INTEREST = ['FOG_SET_IN', 'WIND_ROSE', 'SKY_CLEARED', 'WIND_EASED', 'SIGHTED'] as const;
type NarrationKind = (typeof BY_INTEREST)[number];

interface Candidate {
  kind: NarrationKind;
  cell: CellId;
  payload: Record<string, unknown>;
}

/** Where the smoke is now, by server truth — never by interpolation. */
function currentCell(message: Message): CellId | null {
  const route = Array.isArray(message.route) ? (message.route as CellId[]) : [];
  if (route.length === 0) return null;
  const leg = Math.min(Math.max(0, message.current_leg), route.length - 1);
  return route[leg] ?? null;
}

/** The cell after this one, for "passing north" and for looking ahead. */
function nextCell(message: Message): CellId | null {
  const route = Array.isArray(message.route) ? (message.route as CellId[]) : [];
  const leg = message.current_leg + 1;
  return route[leg] ?? null;
}

/** Compass heading of travel, for a station reporting which way it went. */
function heading(from: CellId, to: CellId): number {
  return initialBearingDeg(cellCenter(from), cellCenter(to));
}

export async function runNarration(ctx: EngineContext): Promise<NarrationStats> {
  const stats: NarrationStats = { considered: 0, spoke: 0, throttled: 0 };
  if (!ctx.config.get('narration.enabled')) return stats;

  const now = ctx.clock.now();
  const intervalMs = ctx.config.get('narration.min_interval_hours') * 3_600_000;
  const flying = await messagesInStates(ctx.db, ['IN_FLIGHT', 'STRANDED']);

  for (const message of flying) {
    stats.considered++;

    const here = currentCell(message);
    if (here === null) continue;

    // Rule 2, checked before any work: a message that spoke recently stays quiet.
    const { rows: recent } = await ctx.db.query<{ created_at: Date; kind: string }>(
      `select created_at, kind from public.events
        where message_id = $1 and kind = any($2::text[])
        order by created_at desc limit 1`,
      [message.id, [...BY_INTEREST]],
    );
    const last = recent[0];
    if (last !== undefined && now.getTime() - new Date(last.created_at).getTime() < intervalMs) {
      stats.throttled++;
      continue;
    }

    const candidate = await pickCandidate(ctx, message, here, last?.kind ?? null);
    if (candidate === null) continue;

    await recordEvent(ctx.db, message.id, candidate.kind, candidate.payload, now);
    stats.spoke++;
  }

  return stats;
}

/**
 * The most interesting true thing a station could say right now.
 *
 * Weather is compared against the *last narrated* state rather than a stored
 * snapshot: the Ledger is the memory. If the last thing a tower said was that
 * the wind got up, it has nothing to add by saying so again — but it does have
 * something to say when the wind drops.
 */
async function pickCandidate(
  ctx: EngineContext,
  message: Message,
  here: CellId,
  lastKind: string | null,
): Promise<Candidate | null> {
  const ahead = nextCell(message);
  const cells = ahead === null ? [here] : [here, ahead];
  const weather = await ctx.weather.getCellWeather(cells);

  const galeThreshold = ctx.config.get('wind.gale_threshold_mph');
  const blinding = ctx.config.get('night.blinding_conditions');

  const atHere = weather.get(here);
  const atAhead = ahead === null ? undefined : weather.get(ahead);

  const found: Candidate[] = [];

  if (atHere !== undefined) {
    const galing = atHere.windMph > galeThreshold;
    if (galing && lastKind !== 'WIND_ROSE') {
      found.push({
        kind: 'WIND_ROSE',
        cell: here,
        payload: { cell: here, wind_mph: Math.round(atHere.windMph) },
      });
    }
    if (!galing && lastKind === 'WIND_ROSE') {
      found.push({
        kind: 'WIND_EASED',
        cell: here,
        payload: { cell: here, wind_mph: Math.round(atHere.windMph) },
      });
    }
  }

  // Blindness is reported about the air *ahead*: a station cannot see what it
  // cannot see, and the interesting moment is realising the next light is gone.
  const lookAt = atAhead ?? atHere;
  const lookCell = atAhead !== undefined && ahead !== null ? ahead : here;
  if (lookAt !== undefined) {
    const blind = blinding.includes(lookAt.condition as (typeof blinding)[number]);
    if (blind && lastKind !== 'FOG_SET_IN') {
      found.push({
        kind: 'FOG_SET_IN',
        cell: lookCell,
        payload: { cell: lookCell, condition: lookAt.condition },
      });
    }
    if (!blind && lastKind === 'FOG_SET_IN') {
      found.push({
        kind: 'SKY_CLEARED',
        cell: lookCell,
        payload: { cell: lookCell, condition: lookAt.condition },
      });
    }
  }

  // Rule 3: a sighting is what a station says when it has nothing better. Only
  // in flight — a stranded message is not passing anybody.
  if (found.length === 0 && message.state === 'IN_FLIGHT' && ahead !== null) {
    found.push({
      kind: 'SIGHTED',
      cell: here,
      payload: { cell: here, heading_deg: Math.round(heading(here, ahead)) },
    });
  }

  if (found.length === 0) return null;
  found.sort((a, b) => BY_INTEREST.indexOf(a.kind) - BY_INTEREST.indexOf(b.kind));
  return found[0]!;
}

export type { SegmentEta };
