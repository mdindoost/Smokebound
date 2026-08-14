/**
 * Minimal HS256 verification for Supabase access tokens.
 *
 * The HTTP transport has to answer "who is asking?" without a Supabase client
 * round-trip. Supabase signs access tokens with the project's JWT secret, so
 * verifying the signature locally is enough — and it keeps the engine's inbound
 * path dependency-free.
 *
 * Deliberately narrow: HS256 only (an `alg` we accept from the token itself is
 * the classic JWT vulnerability), signature checked before anything is trusted,
 * and `exp` enforced.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

export interface JwtClaims {
  sub?: string;
  exp?: number;
  role?: string;
  [key: string]: unknown;
}

export type JwtResult =
  | { ok: true; claims: JwtClaims; subject: string }
  | { ok: false; reason: 'malformed' | 'bad_algorithm' | 'bad_signature' | 'expired' | 'no_subject' };

export function verifySupabaseJwt(token: string, secret: string, now: Date): JwtResult {
  const parts = token.split('.');
  if (parts.length !== 3) return { ok: false, reason: 'malformed' };
  const [header, payload, signature] = parts as [string, string, string];

  let decodedHeader: { alg?: string };
  let claims: JwtClaims;
  try {
    decodedHeader = JSON.parse(Buffer.from(header, 'base64url').toString('utf8'));
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return { ok: false, reason: 'malformed' };
  }

  if (decodedHeader.alg !== 'HS256') return { ok: false, reason: 'bad_algorithm' };

  const expected = createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: 'bad_signature' };
  }

  if (typeof claims.exp === 'number' && claims.exp * 1000 <= now.getTime()) {
    return { ok: false, reason: 'expired' };
  }
  if (typeof claims.sub !== 'string' || claims.sub.length === 0) {
    return { ok: false, reason: 'no_subject' };
  }

  return { ok: true, claims, subject: claims.sub };
}

/** Test/dev helper: mint a token the verifier accepts. */
export function signSupabaseJwt(claims: JwtClaims, secret: string): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const signature = createHmac('sha256', secret)
    .update(`${header}.${payload}`)
    .digest('base64url');
  return `${header}.${payload}.${signature}`;
}
