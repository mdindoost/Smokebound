/**
 * `/preview`, `/send`, `/resend` (ARCHITECTURE §6.4).
 *
 * These are transport-agnostic on purpose: the HTTP server and the table-polling
 * worker both call exactly these functions, so the beta can run fully outbound
 * from a home server without a second code path to keep honest.
 *
 * The rule that shapes the whole file is REDTEAM F17: **a send never fails for
 * want of a route.** A walled-off sky is the product working, not an error. The
 * message is created, it transmits, and then it strands at its origin until the
 * replan cron finds it a way out.
 */

import {
  cellCenter,
  cellSteps,
  haversineKm,
  isTraversable,
} from '@smoke/shared';
import type { CellId, Message, SegmentEta, Uuid } from '@smoke/shared';

import { addMinutes, addHours } from '../engine/clock.js';
import type { EngineContext } from '../engine/context.js';
import {
  countSendsSince,
  flockStatusBetween,
  getMessage,
  getProfile,
  insertMessage,
  isBlockedBetween,
  recordEvent,
} from '../db/repo.js';
import { EngineError, blocked, bodyTooLong, notFlock, rateLimited } from './errors.js';
import { planJourney } from './planning.js';
import type { StormNote } from './planning.js';
import { graphemeCount, transmissionSeconds } from './text.js';
import { hashBody, signPreviewToken, verifyPreviewToken } from './token.js';
import { keeperCellFor } from './keeper.js';
import { toSegmentEtas } from '../routing/astar.js';

const KM_PER_MILE = 1.609344;

export interface PreviewRequest {
  senderId: Uuid;
  recipientId: Uuid;
  body: string;
}

export interface ProximityNote {
  sameCell: boolean;
  adjacent: boolean;
  distanceKm: number;
  walkMinutes: number;
}

export interface PreviewResult {
  originCell: CellId;
  destCell: CellId;
  route: CellId[] | null;
  /** Null when no route exists — the message would strand at its origin (F17). */
  totalHours: number | null;
  transmissionSeconds: number;
  departsAt: string;
  eta: string | null;
  stormsAvoided: StormNote[];
  /** True when the sky is currently closed between these two fires. */
  noRoute: boolean;
  proximity: ProximityNote;
  previewToken: string;
  /** Cells whose weather we fetched specially before quoting (REDTEAM F18). */
  resolvedUnknowns: CellId[];
}

export interface SendRequest extends PreviewRequest {
  previewToken?: string;
}

export interface EtaWarning {
  previewedHours: number;
  actualHours: number | null;
  shiftFraction: number | null;
  reason: 'slower' | 'faster' | 'no_route';
}

export interface SendResult {
  messageId: Uuid;
  state: Message['state'];
  originCell: CellId;
  destCell: CellId;
  route: CellId[] | null;
  totalHours: number | null;
  departsAt: string;
  eta: string | null;
  noRoute: boolean;
  /** Present when the sky moved between preview and send (ARCHITECTURE §6.4). */
  etaWarning: EtaWarning | null;
  /** True when a token was supplied but had aged out; the quote was recomputed. */
  previewExpired: boolean;
  stormsAvoided: StormNote[];
}

// ---------------------------------------------------------------------------
// Shared validation
// ---------------------------------------------------------------------------

interface Parties {
  senderHome: CellId;
  recipientHome: CellId;
  recipientIsKeeper: boolean;
}

async function validateParties(
  ctx: EngineContext,
  senderId: Uuid,
  recipientId: Uuid,
  body: string,
): Promise<Parties> {
  const cap = ctx.config.get('message.char_cap');
  const length = graphemeCount(body);
  if (length === 0) throw new EngineError('BODY_EMPTY', 'A signal needs something to say.');
  if (length > cap) throw bodyTooLong(length, cap);

  // The cap is enforced twice, in two different units, because the spec defines
  // it in two different units and both are load-bearing:
  //   * grapheme clusters — what a person sees and what garbling operates on
  //     (MECHANICS §5, §6.2), checked above;
  //   * code points — what `char_length(body) <= 280` counts in the schema
  //     (ARCHITECTURE §3), checked here.
  // For plain text they are the same number. For emoji and combining scripts
  // they are not, and a body that passed the first check can still be rejected
  // by the database. Better a clear refusal than a constraint violation.
  const codePoints = [...body].length;
  if (codePoints > cap) {
    throw new EngineError(
      'BODY_TOO_LONG',
      `That message is ${length} characters but ${codePoints} code points; the store caps it at ${cap}.`,
      { length, codePoints, cap, unit: 'code_points' },
    );
  }

  const [sender, recipient] = await Promise.all([
    getProfile(ctx.db, senderId),
    getProfile(ctx.db, recipientId),
  ]);
  if (!sender) throw new EngineError('PROFILE_NOT_FOUND', 'Sender has no profile.');
  if (!recipient) throw new EngineError('PROFILE_NOT_FOUND', 'No such handle.');
  if (senderId === recipientId) throw notFlock();

  // Blocks are checked before flock so a blocked user learns nothing new.
  if (await isBlockedBetween(ctx.db, senderId, recipientId)) throw blocked();
  if ((await flockStatusBetween(ctx.db, senderId, recipientId)) !== 'accepted') throw notFlock();

  const recipientIsKeeper = ctx.keeperId !== null && recipientId === ctx.keeperId;

  return {
    senderHome: sender.home_cell,
    // The Keeper has no fixed address: its fire is always one cell from yours
    // (REDTEAM F5), so every user gets a real send→track→deliver loop on day one.
    recipientHome: recipientIsKeeper ? keeperCellFor(sender.home_cell) : recipient.home_cell,
    recipientIsKeeper,
  };
}

async function enforceRateLimit(ctx: EngineContext, senderId: Uuid): Promise<void> {
  // The rate limit is an abuse and push-cost guard on *people* (ARCHITECTURE §8).
  // The Keeper answers everyone, so it would trip the limit by lunchtime.
  if (ctx.keeperId !== null && senderId === ctx.keeperId) return;

  const cap = ctx.config.get('limits.sends_per_user_per_day');
  const since = addHours(ctx.clock.now(), -24);
  const sentToday = await countSendsSince(ctx.db, senderId, since);
  if (sentToday >= cap) throw rateLimited(sentToday, cap);
}

function proximityFor(ctx: EngineContext, origin: CellId, dest: CellId): ProximityNote {
  const distanceKm = haversineKm(cellCenter(origin), cellCenter(dest));
  const walkMph = ctx.config.get('speed.walking_mph');
  return {
    sameCell: origin === dest,
    adjacent: origin !== dest && cellSteps(origin, dest) === 1,
    distanceKm,
    walkMinutes: (distanceKm / KM_PER_MILE / walkMph) * 60,
  };
}

interface Schedule {
  transmissionSeconds: number;
  departsAt: Date;
  eta: Date | null;
  segmentEtas: SegmentEta[] | null;
}

/**
 * Transmission first (MECHANICS §3), then flight, then the delivery floor
 * (§7B): nothing arrives instantly, however close the two fires are.
 */
function schedule(
  ctx: EngineContext,
  sentAt: Date,
  body: string,
  journey: { totalHours: number | null; waypoints?: { leg: number; cell: CellId; cumulativeHours: number }[] },
): Schedule {
  const seconds = transmissionSeconds(body, ctx.config);
  const departsAt = new Date(sentAt.getTime() + seconds * 1000);

  if (journey.totalHours === null) {
    return { transmissionSeconds: seconds, departsAt, eta: null, segmentEtas: null };
  }

  const arrival = addHours(departsAt, journey.totalHours);
  const floor = addMinutes(sentAt, ctx.config.get('delivery.min_floor_minutes'));
  const eta = arrival.getTime() < floor.getTime() ? floor : arrival;

  return {
    transmissionSeconds: seconds,
    departsAt,
    eta,
    segmentEtas: journey.waypoints ? toSegmentEtas(journey.waypoints, departsAt) : null,
  };
}

// ---------------------------------------------------------------------------
// /preview
// ---------------------------------------------------------------------------

export async function previewMessage(
  ctx: EngineContext,
  request: PreviewRequest,
): Promise<PreviewResult> {
  const parties = await validateParties(ctx, request.senderId, request.recipientId, request.body);
  const now = ctx.clock.now();

  const journey = await planJourney(ctx, parties.senderHome, parties.recipientHome, {
    resolveUnknowns: true,
  });

  const totalHours = journey.result.status === 'OK' ? journey.result.totalHours : null;
  const plan = schedule(ctx, now, request.body, {
    totalHours,
    waypoints: journey.result.status === 'OK' ? journey.result.waypoints : undefined,
  });

  const token = signPreviewToken(
    {
      sender: request.senderId,
      recipient: request.recipientId,
      bodyHash: hashBody(request.body),
      origin: parties.senderHome,
      dest: parties.recipientHome,
      hours: totalHours,
      issuedAt: now.getTime(),
    },
    ctx.previewSecret,
  );

  return {
    originCell: parties.senderHome,
    destCell: parties.recipientHome,
    route: journey.result.status === 'OK' ? journey.result.route : null,
    totalHours,
    transmissionSeconds: plan.transmissionSeconds,
    departsAt: plan.departsAt.toISOString(),
    eta: plan.eta?.toISOString() ?? null,
    stormsAvoided: journey.stormsAvoided,
    noRoute: journey.result.status !== 'OK',
    proximity: proximityFor(ctx, parties.senderHome, parties.recipientHome),
    previewToken: token,
    resolvedUnknowns: journey.resolvedUnknowns,
  };
}

// ---------------------------------------------------------------------------
// /send
// ---------------------------------------------------------------------------

export async function sendMessage(ctx: EngineContext, request: SendRequest): Promise<SendResult> {
  const parties = await validateParties(ctx, request.senderId, request.recipientId, request.body);
  await enforceRateLimit(ctx, request.senderId);

  const now = ctx.clock.now();

  let previewedHours: number | null = null;
  let previewExpired = false;

  if (request.previewToken) {
    const verified = verifyPreviewToken(request.previewToken, {
      secret: ctx.previewSecret,
      now,
      ttlMs: ctx.config.get('preview.token_ttl_minutes') * 60_000,
      expect: {
        sender: request.senderId,
        recipient: request.recipientId,
        bodyHash: hashBody(request.body),
      },
    });

    if (verified.ok) previewedHours = verified.payload.hours;
    else if (verified.reason === 'expired') previewExpired = true;
    else {
      throw new EngineError('INVALID_TOKEN', 'That preview does not match this message.', {
        reason: verified.reason,
      });
    }
  }

  // Always recompute: the token is a record of what the user was told, never a
  // cached route to reuse.
  const journey = await planJourney(ctx, parties.senderHome, parties.recipientHome, {
    resolveUnknowns: true,
  });
  const totalHours = journey.result.status === 'OK' ? journey.result.totalHours : null;
  const plan = schedule(ctx, now, request.body, {
    totalHours,
    waypoints: journey.result.status === 'OK' ? journey.result.waypoints : undefined,
  });

  const message = await insertMessage(ctx.db, {
    sender: request.senderId,
    recipient: request.recipientId,
    body: request.body,
    originCell: parties.senderHome,
    destCell: parties.recipientHome,
    route: journey.result.status === 'OK' ? journey.result.route : null,
    segmentEtas: plan.segmentEtas,
    departedAt: plan.departsAt,
    eta: plan.eta,
    createdAt: now,
  });

  await recordEvent(ctx.db, message.id, 'SENT', {
    origin_cell: parties.senderHome,
    dest_cell: parties.recipientHome,
    total_hours: totalHours,
    no_route: journey.result.status !== 'OK',
    storms_avoided: journey.stormsAvoided.length,
  });

  await ctx.push.dispatch({
    userId: request.senderId,
    kind: 'SENT',
    title: 'Your fire is lit',
    body:
      totalHours === null
        ? 'The sky is closed. Your signal is waiting for a gap.'
        : `Your signal is transmitting. Expected arrival in ${Math.round(totalHours)} h.`,
    data: { message_id: message.id },
  });

  return {
    messageId: message.id,
    state: message.state,
    originCell: parties.senderHome,
    destCell: parties.recipientHome,
    route: journey.result.status === 'OK' ? journey.result.route : null,
    totalHours,
    departsAt: plan.departsAt.toISOString(),
    eta: plan.eta?.toISOString() ?? null,
    noRoute: journey.result.status !== 'OK',
    etaWarning: etaWarningFor(ctx, previewedHours, totalHours),
    previewExpired,
    stormsAvoided: journey.stormsAvoided,
  };
}

function etaWarningFor(
  ctx: EngineContext,
  previewedHours: number | null,
  actualHours: number | null,
): EtaWarning | null {
  if (previewedHours === null) return null;

  if (actualHours === null) {
    return { previewedHours, actualHours: null, shiftFraction: null, reason: 'no_route' };
  }
  if (previewedHours <= 0) return null;

  const shift = (actualHours - previewedHours) / previewedHours;
  const threshold = ctx.config.get('preview.eta_shift_warn_fraction');
  if (Math.abs(shift) <= threshold) return null;

  return {
    previewedHours,
    actualHours,
    shiftFraction: shift,
    reason: shift > 0 ? 'slower' : 'faster',
  };
}

// ---------------------------------------------------------------------------
// /resend  ("light a new fire", MECHANICS §6.3)
// ---------------------------------------------------------------------------

export async function resendMessage(
  ctx: EngineContext,
  request: { senderId: Uuid; messageId: Uuid },
): Promise<SendResult> {
  const original = await getMessage(ctx.db, request.messageId);
  if (!original) throw new EngineError('MESSAGE_NOT_FOUND', 'No such message.');
  if (original.sender !== request.senderId) {
    throw new EngineError('NOT_YOUR_MESSAGE', 'You can only re-light your own fires.');
  }

  return sendMessage(ctx, {
    senderId: original.sender,
    recipientId: original.recipient,
    body: original.body,
  });
}

/** Exposed for the transports: is this cell one smoke could ever occupy? */
export const cellIsRoutable = isTraversable;
