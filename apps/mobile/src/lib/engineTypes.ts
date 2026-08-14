/**
 * The engine's API contract (ARCHITECTURE §6.4), as the client sees it.
 *
 * Declared here rather than imported from `@smoke/engine` so the app never
 * bundles the server. `test/contract.test.ts` asserts these stay assignable to
 * the engine's own types, so the duplication cannot drift silently.
 */

export type EngineRequestKind = 'preview' | 'send' | 'resend';

export interface StormNote {
  cell: string;
  condition: string;
  impassable: boolean;
}

export interface ProximityNote {
  sameCell: boolean;
  adjacent: boolean;
  distanceKm: number;
  walkMinutes: number;
}

export interface PreviewResult {
  originCell: string;
  destCell: string;
  route: string[] | null;
  totalHours: number | null;
  transmissionSeconds: number;
  departsAt: string;
  eta: string | null;
  stormsAvoided: StormNote[];
  noRoute: boolean;
  proximity: ProximityNote;
  previewToken: string;
  resolvedUnknowns: string[];
}

export interface EtaWarning {
  previewedHours: number;
  actualHours: number | null;
  shiftFraction: number | null;
  reason: 'slower' | 'faster' | 'no_route';
}

export interface SendResult {
  messageId: string;
  state: string;
  originCell: string;
  destCell: string;
  route: string[] | null;
  totalHours: number | null;
  departsAt: string;
  eta: string | null;
  noRoute: boolean;
  etaWarning: EtaWarning | null;
  previewExpired: boolean;
  stormsAvoided: StormNote[];
}

export type EngineReply<T> =
  | { ok: true; payload: T }
  | { ok: false; code: string; message: string; details?: Record<string, unknown> };

/** Thrown for a refusal the user can act on: not flock, blocked, too long, rate limited. */
export class EngineRequestError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'EngineRequestError';
  }
}
