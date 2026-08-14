/**
 * Preview tokens (ARCHITECTURE §6.4).
 *
 * A preview shows a route and an ETA; the send that follows quotes the token so
 * the engine knows what the user was promised and can warn when the sky has
 * moved since (>20% ETA shift). The token is signed rather than stored: it
 * carries no authority — the send re-validates everything from scratch — so a
 * database row and its cleanup would be pure overhead.
 */

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

import type { CellId, Uuid } from '@smoke/shared';

export interface PreviewTokenPayload {
  sender: Uuid;
  recipient: Uuid;
  /** Hash, not the body: the token travels through the client. */
  bodyHash: string;
  origin: CellId;
  dest: CellId;
  /** What the user was quoted, in hours. Null when the preview found no route. */
  hours: number | null;
  issuedAt: number;
}

export type TokenVerification =
  | { ok: true; payload: PreviewTokenPayload }
  | { ok: false; reason: 'malformed' | 'bad_signature' | 'expired' | 'mismatch' };

const base64url = (input: Buffer | string): string =>
  Buffer.from(input).toString('base64url');

export function hashBody(body: string): string {
  return createHash('sha256').update(body, 'utf8').digest('base64url');
}

function sign(data: string, secret: string): string {
  return createHmac('sha256', secret).update(data).digest('base64url');
}

export function signPreviewToken(payload: PreviewTokenPayload, secret: string): string {
  const data = base64url(JSON.stringify(payload));
  return `${data}.${sign(data, secret)}`;
}

export interface VerifyOptions {
  secret: string;
  now: Date;
  ttlMs: number;
  /** The send's own parameters, which the token must match. */
  expect?: { sender: Uuid; recipient: Uuid; bodyHash: string };
}

export function verifyPreviewToken(token: string, options: VerifyOptions): TokenVerification {
  const [data, signature] = token.split('.');
  if (!data || !signature) return { ok: false, reason: 'malformed' };

  const expected = sign(data, options.secret);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: 'bad_signature' };
  }

  let payload: PreviewTokenPayload;
  try {
    payload = JSON.parse(Buffer.from(data, 'base64url').toString('utf8')) as PreviewTokenPayload;
  } catch {
    return { ok: false, reason: 'malformed' };
  }

  if (options.expect) {
    const matches =
      payload.sender === options.expect.sender &&
      payload.recipient === options.expect.recipient &&
      payload.bodyHash === options.expect.bodyHash;
    if (!matches) return { ok: false, reason: 'mismatch' };
  }

  if (options.now.getTime() - payload.issuedAt > options.ttlMs) {
    return { ok: false, reason: 'expired' };
  }

  return { ok: true, payload };
}
