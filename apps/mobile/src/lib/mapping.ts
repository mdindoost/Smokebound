/**
 * Row → view mapping, shared by every gateway implementation so the real one
 * and the test one cannot disagree about what a thread looks like.
 *
 * One thing to know while reading this: **a recipient sees nothing until a
 * message lands.** That is RLS (ARCHITECTURE §3) and it is also the product
 * (SPEC §4.4) — so an inbound message simply does not exist here until it is
 * DELIVERED. There is no "in the sky toward you" hint to build, because the row
 * is not visible. See the M5 note in the README.
 */

import type { SegmentEta } from './flight';
import type {
  ConversationView,
  MessageEventView,
  ProfileView,
  ThreadMessageView,
} from './gateway';

export interface MessageRow {
  id: string;
  sender: string;
  recipient: string;
  body: string | null;
  body_delivered: string | null;
  state: string;
  origin_cell: string;
  dest_cell: string;
  route: string[] | null;
  segment_etas: unknown;
  current_leg: number | null;
  departed_at: string | null;
  eta: string | null;
  delivered_at: string | null;
  stranded_cell: string | null;
  lost_at: string | null;
  lost_cell: string | null;
  lost_reason: string | null;
  garble_events: unknown;
  created_at: string;
}

export interface EventRow {
  message_id: string;
  kind: string;
  payload: Record<string, unknown> | null;
  created_at: string;
}

export interface ProfileRow {
  id: string;
  handle: string;
  display_name: string | null;
  home_cell: string | null;
  is_system?: boolean;
}

export const toProfileView = (row: ProfileRow): ProfileView => ({
  id: row.id,
  handle: row.handle,
  displayName: row.display_name,
  homeCell: row.home_cell,
  isSystem: row.is_system === true,
});

const garbleCount = (value: unknown): number => (Array.isArray(value) ? value.length : 0);

export function toThreadMessage(
  row: MessageRow,
  events: EventRow[],
  myId: string,
): ThreadMessageView {
  const direction: 'out' | 'in' = row.sender === myId ? 'out' : 'in';
  return {
    id: row.id,
    direction,
    body: row.body,
    bodyDelivered: row.body_delivered,
    state: row.state,
    createdAt: row.created_at,
    departedAt: row.departed_at,
    eta: row.eta,
    deliveredAt: row.delivered_at,
    strandedCell: row.stranded_cell,
    lostAt: row.lost_at,
    lostCell: row.lost_cell,
    lostReason: row.lost_reason,
    originCell: row.origin_cell,
    destCell: row.dest_cell,
    route: Array.isArray(row.route) ? row.route : null,
    segmentEtas: Array.isArray(row.segment_etas) ? (row.segment_etas as SegmentEta[]) : null,
    currentLeg: typeof row.current_leg === 'number' ? row.current_leg : null,
    garbleCount: garbleCount(row.garble_events),
    events: events
      .filter((event) => event.message_id === row.id)
      .map(
        (event): MessageEventView => ({
          kind: event.kind,
          at: event.created_at,
          payload: event.payload,
        }),
      ),
  };
}

/** What a thread bubble shows: the delivered text if there is one, else the original. */
export function displayText(message: ThreadMessageView): string | null {
  if (message.state === 'DELIVERED') return message.bodyDelivered ?? message.body;
  return message.body;
}

/** True when the wind got at it (MECHANICS §6.2). */
export function isWindDamaged(message: ThreadMessageView): boolean {
  return (
    message.state === 'DELIVERED' &&
    message.garbleCount > 0 &&
    message.bodyDelivered !== null &&
    message.bodyDelivered !== message.body
  );
}

export function toConversations(
  messages: ThreadMessageView[],
  people: Map<string, ProfileView>,
  myId: string,
  senderOf: (message: ThreadMessageView) => string,
  recipientOf: (message: ThreadMessageView) => string,
): ConversationView[] {
  const byOther = new Map<string, ThreadMessageView[]>();

  for (const message of messages) {
    const other = senderOf(message) === myId ? recipientOf(message) : senderOf(message);
    byOther.set(other, [...(byOther.get(other) ?? []), message]);
  }

  const conversations: ConversationView[] = [];

  for (const [otherId, thread] of byOther) {
    const profile = people.get(otherId);
    if (!profile) continue;

    const sorted = [...thread].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const last = sorted[sorted.length - 1]!;
    conversations.push({
      other: profile,
      lastAt: last.createdAt,
      lastLine: displayText(last) ?? '',
      lastState: last.state,
      inFlight: sorted.filter(
        (m) =>
          m.direction === 'out' &&
          (m.state === 'TRANSMITTING' || m.state === 'IN_FLIGHT' || m.state === 'STRANDED'),
      ).length,
    });
  }

  return conversations.sort((a, b) => (b.lastAt ?? '').localeCompare(a.lastAt ?? ''));
}
