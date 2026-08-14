/**
 * Data-model types mirroring the Postgres schema in ARCHITECTURE §3.
 *
 * Field names are snake_case on purpose: these are row shapes, so they line up
 * 1:1 with what supabase-js returns. `null` vs `undefined` follows the SQL —
 * nullable columns are `| null`, columns with defaults are optional on insert.
 */

import type { CellId } from '../geo/types.js';

/** ISO-8601 timestamp string (`timestamptz` as serialised by PostgREST). */
export type Timestamptz = string;
export type Uuid = string;

// ---------------------------------------------------------------------------
// profiles
// ---------------------------------------------------------------------------

export interface Profile {
  id: Uuid;
  /** @name, 3–20 chars, unique. */
  handle: string;
  display_name: string | null;
  /** Coarse home cell — never raw lat/lng (ARCHITECTURE §8). */
  home_cell: CellId;
  last_active_at: Timestamptz | null;
  expo_push_token: string | null;
  created_at: Timestamptz;
}

/** What a flock member is allowed to see of someone else (RLS-trimmed view). */
export type PublicProfile = Pick<Profile, 'id' | 'handle' | 'display_name' | 'home_cell'>;

// ---------------------------------------------------------------------------
// flock (symmetric friendships, stored with a < b)
// ---------------------------------------------------------------------------

export type FlockStatus = 'pending' | 'accepted';

export interface FlockEdge {
  a: Uuid;
  b: Uuid;
  status: FlockStatus;
  requested_by: Uuid;
  created_at: Timestamptz;
}

/** Canonical (a, b) ordering for the composite primary key. */
export function flockPair(x: Uuid, y: Uuid): { a: Uuid; b: Uuid } {
  return x < y ? { a: x, b: y } : { a: y, b: x };
}

// ---------------------------------------------------------------------------
// blocks / reports (App Store 1.2 — REDTEAM F1)
// ---------------------------------------------------------------------------

export interface Block {
  blocker: Uuid;
  blocked: Uuid;
  created_at: Timestamptz;
}

export interface Report {
  id: number;
  reporter: Uuid;
  message_id: Uuid | null;
  reason: string | null;
  created_at: Timestamptz;
}

// ---------------------------------------------------------------------------
// messages
// ---------------------------------------------------------------------------

export type MessageState = 'TRANSMITTING' | 'IN_FLIGHT' | 'STRANDED' | 'DELIVERED' | 'LOST';

export const MESSAGE_STATES: readonly MessageState[] = [
  'TRANSMITTING',
  'IN_FLIGHT',
  'STRANDED',
  'DELIVERED',
  'LOST',
] as const;

/** Terminal states — no further transitions (ARCHITECTURE §4). */
export const TERMINAL_MESSAGE_STATES: readonly MessageState[] = ['DELIVERED', 'LOST'] as const;

export function isTerminalState(state: MessageState): boolean {
  return TERMINAL_MESSAGE_STATES.includes(state);
}

/** Legal transitions of the message state machine (ARCHITECTURE §4). */
export const MESSAGE_TRANSITIONS: Readonly<Record<MessageState, readonly MessageState[]>> = {
  TRANSMITTING: ['IN_FLIGHT'],
  IN_FLIGHT: ['STRANDED', 'DELIVERED'],
  STRANDED: ['IN_FLIGHT', 'LOST'],
  DELIVERED: [],
  LOST: [],
} as const;

export function canTransition(from: MessageState, to: MessageState): boolean {
  return MESSAGE_TRANSITIONS[from].includes(to);
}

/** One entry of `messages.segment_etas` — cumulative server truth per waypoint. */
export interface SegmentEta {
  /** Index into `route`. */
  leg: number;
  cell: CellId;
  /** Cumulative hours from departure to arriving at this waypoint. */
  cumulative_hours: number;
  /** Absolute arrival time at this waypoint. */
  eta: Timestamptz;
}

/** One entry of `messages.garble_events` (MECHANICS §6.2). */
export interface GarbleEvent {
  cell: CellId;
  at: Timestamptz;
  chars_hit: number;
}

export interface Message {
  id: Uuid;
  sender: Uuid;
  recipient: Uuid;
  /** Original text. Capped at `message.char_cap` (MECHANICS §5). */
  body: string;
  /** Post-garble text; null until DELIVERED. */
  body_delivered: string | null;
  state: MessageState;
  origin_cell: CellId;
  dest_cell: CellId;
  route: CellId[] | null;
  segment_etas: SegmentEta[] | null;
  current_leg: number;
  departed_at: Timestamptz | null;
  eta: Timestamptz | null;
  stranded_since: Timestamptz | null;
  stranded_cell: CellId | null;
  garble_events: GarbleEvent[];
  lost_at: Timestamptz | null;
  lost_cell: CellId | null;
  lost_reason: string | null;
  delivered_at: Timestamptz | null;
  created_at: Timestamptz;
}

/** What a client is allowed to insert; everything else is engine-owned. */
export interface NewMessage {
  sender: Uuid;
  recipient: Uuid;
  body: string;
  origin_cell: CellId;
  dest_cell: CellId;
}

// ---------------------------------------------------------------------------
// weather_cells
// ---------------------------------------------------------------------------

export interface WeatherCell {
  cell: CellId;
  /** Bucketed NWS condition; see `WeatherCondition` in the mechanics types. */
  condition: string | null;
  wind_mph: number | null;
  /**
   * Meteorological convention, as NWS reports it: degrees the wind blows *from*,
   * clockwise from true north. A 270 wind is a westerly, pushing smoke east.
   */
  wind_dir: number | null;
  /** Precomputed from the MECHANICS §2.1 table at fetch time. */
  time_mult: number | null;
  /** True only while an NWS severe warning/watch is active (REDTEAM F2). */
  impassable: boolean;
  fetched_at: Timestamptz | null;
}

// ---------------------------------------------------------------------------
// events
// ---------------------------------------------------------------------------

export type EventKind =
  | 'SENT'
  | 'DEPARTED'
  | 'STRANDED'
  | 'RESUMED'
  | 'GARBLED'
  | 'DELIVERED'
  | 'LOST';

export const EVENT_KINDS: readonly EventKind[] = [
  'SENT',
  'DEPARTED',
  'STRANDED',
  'RESUMED',
  'GARBLED',
  'DELIVERED',
  'LOST',
] as const;

export interface MessageEvent {
  id: number;
  message_id: Uuid;
  kind: EventKind;
  payload: Record<string, unknown> | null;
  created_at: Timestamptz;
}
