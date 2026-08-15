/**
 * Everything a screen is allowed to know about the outside world.
 *
 * Screens depend on this interface, not on Supabase — which is what lets the
 * two-client end-to-end test drive the same code against a real engine and a
 * real Postgres without a network, and what will let the HTTP transport swap in
 * without touching a screen.
 */

import type { PreviewResult, SendResult } from './engineTypes';
import type { SegmentEta } from './flight';

export interface SessionUser {
  id: string;
}

export interface ProfileView {
  id: string;
  handle: string;
  displayName: string | null;
  /** Only ever present for yourself and your flock (RLS, ARCHITECTURE §3). */
  homeCell: string | null;
  isSystem?: boolean;
}

export type FlockStatus = 'pending' | 'accepted';

export interface FlockEntry {
  profile: ProfileView;
  status: FlockStatus;
  /** True when they asked you, false when you asked them. */
  incoming: boolean;
}

export interface MessageEventView {
  kind: string;
  at: string;
  payload: Record<string, unknown> | null;
}

export interface ThreadMessageView {
  id: string;
  direction: 'out' | 'in';
  /** The original. Null for an inbound message that has not landed (RLS). */
  body: string | null;
  /** What actually arrived — wind damage included (MECHANICS §6.2). */
  bodyDelivered: string | null;
  state: string;
  createdAt: string;
  departedAt: string | null;
  eta: string | null;
  deliveredAt: string | null;
  strandedCell: string | null;
  lostAt: string | null;
  lostCell: string | null;
  lostReason: string | null;
  originCell: string;
  destCell: string;
  /** Server truth: the committed route, and the ETA of each waypoint. */
  route: string[] | null;
  segmentEtas: SegmentEta[] | null;
  /**
   * The last waypoint the *engine* has confirmed. Client interpolation runs
   * ahead of this between ticks, and must not be narrated as though it were
   * fact — see `confirmedLeg` in the flight view.
   */
  currentLeg: number | null;
  garbleCount: number;
  events: MessageEventView[];
}

export interface ConversationView {
  other: ProfileView;
  lastAt: string | null;
  lastLine: string;
  lastState: string | null;
  /** Outbound messages still in the sky. */
  inFlight: number;
}

export interface CellWeatherView {
  cell: string;
  condition: string | null;
  impassable: boolean;
  weatherUnknown: boolean;
  windMph: number | null;
  /** Degrees the wind blows *from*, meteorological convention. */
  windDir: number | null;
}

export interface MechanicsView {
  charCap: number;
  baseKmh: number;
  minFloorMinutes: number;
  /**
   * Draw fire-at-night on the map (REDTEAM F32). Default on: theater is always
   * honest about what the sky looks like.
   */
  nightVisuals: boolean;
  /**
   * Whether night actually *changes* anything (REDTEAM F32).
   *
   * Gates copy that claims speed, and nothing else. Showing a fire is a
   * description of the world; saying it travels faster is a claim about the
   * model, and until this is true it would be a false one.
   */
  nightMechanics: boolean;
  /** Solar elevation below which the map draws night. −6° = civil twilight. */
  twilightElevationDeg: number;
  /** Longest walk worth suggesting instead of sending (MECHANICS §7.1). */
  walkSuggestMaxMinutes: number;
  /** Shortest delivery that makes walking worth mentioning at all. */
  walkSuggestMinDeliveryMinutes: number;
}

/** Everything the app can do. Implemented for Supabase, and for tests. */
export interface DataGateway {
  // --- session ---
  currentUser(): Promise<SessionUser | null>;
  signInWithPhone(phone: string): Promise<void>;
  verifyPhoneOtp(phone: string, token: string): Promise<SessionUser>;
  signOut(): Promise<void>;

  // --- profile / onboarding ---
  myProfile(): Promise<ProfileView | null>;
  claimProfile(input: { handle: string; displayName?: string; homeCell: string }): Promise<ProfileView>;
  moveFire(homeCell: string): Promise<void>;
  findByHandle(handle: string): Promise<ProfileView | null>;
  /** The Keeper, if it has been seeded (SPEC §3, REDTEAM F5). */
  keeper(): Promise<ProfileView | null>;

  // --- flock ---
  listFlock(): Promise<FlockEntry[]>;
  requestFlock(otherId: string): Promise<void>;
  acceptFlock(otherId: string): Promise<void>;
  removeFlock(otherId: string): Promise<void>;

  // --- safety (App Store 1.2, REDTEAM F1) ---
  block(otherId: string): Promise<void>;
  unblock(otherId: string): Promise<void>;
  listBlocked(): Promise<ProfileView[]>;
  reportMessage(messageId: string, reason: string): Promise<void>;

  // --- the Sky ---
  /** Your own signals still in the air: what the map draws (ARCHITECTURE §7.1). */
  inFlight(): Promise<ThreadMessageView[]>;
  /** Weather for specific cells, for marking a route (MECHANICS §2.1). */
  cellWeather(cells: readonly string[]): Promise<Map<string, CellWeatherView>>;

  // --- the Ledger ---
  listConversations(): Promise<ConversationView[]>;
  thread(otherId: string): Promise<ThreadMessageView[]>;
  message(messageId: string): Promise<ThreadMessageView | null>;

  // --- the engine ---
  mechanics(): Promise<MechanicsView>;
  preview(recipientId: string, body: string): Promise<PreviewResult>;
  send(recipientId: string, body: string, previewToken?: string): Promise<SendResult>;
  resend(messageId: string): Promise<SendResult>;
}
