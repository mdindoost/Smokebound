/**
 * Dual transport parity (ARCHITECTURE §6.4).
 *
 * The beta runs from a home server behind NAT, so the engine must work fully
 * outbound: the client inserts a request row, the engine answers with a response
 * row. HTTP exists too. The thing that must be true is that they are the same
 * engine — these tests send the same message three ways and compare.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { getMessage } from '../../src/db/repo.js';
import { handleEngineRequest, statusFor } from '../../src/transport/handlers.js';
import { startHttpTransport } from '../../src/transport/http.js';
import { signSupabaseJwt, verifySupabaseJwt } from '../../src/transport/jwt.js';
import { drainEngineRequests } from '../../src/transport/tablePoller.js';
import { parseTransportMode, startTransports } from '../../src/transport/index.js';
import { PEOPLE, createLifecycle } from '../support/lifecycle.js';
import type { Lifecycle } from '../support/lifecycle.js';

const JWT_SECRET = 'test-jwt-secret-at-least-32-chars-long';
const BODY = 'THREE WAYS TO LIGHT ONE FIRE';

let life: Lifecycle | undefined;

afterEach(async () => {
  await life?.close();
  life = undefined;
});

/** The parts of a send result that must not depend on how it arrived. */
function comparable(payload: Record<string, unknown>): Record<string, unknown> {
  const { messageId, departsAt, eta, ...rest } = payload as {
    messageId: string;
    departsAt: string;
    eta: string | null;
  } & Record<string, unknown>;
  void messageId;
  void departsAt;
  void eta;
  return rest;
}

async function postJson(
  url: string,
  token: string,
  body: unknown,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  return { status: response.status, json: (await response.json()) as Record<string, unknown> };
}

async function enqueue(
  life: Lifecycle,
  kind: string,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const { rows } = await life.ctx.db.query<{ id: string }>(
    `insert into public.engine_requests (requester, kind, payload)
     values ($1, $2, $3::jsonb) returning id`,
    [PEOPLE.alice.id, kind, JSON.stringify(payload)],
  );
  const requestId = rows[0]!.id;

  await drainEngineRequests(life.ctx);

  const response = await life.ctx.db.query<{
    ok: boolean;
    payload: Record<string, unknown> | null;
    error_code: string | null;
    error_message: string | null;
  }>(
    `select ok, payload, error_code, error_message from public.engine_responses where request_id = $1`,
    [requestId],
  );
  const status = await life.ctx.db.query<{ status: string }>(
    `select status from public.engine_requests where id = $1`,
    [requestId],
  );

  return { ...response.rows[0]!, requestStatus: status.rows[0]!.status };
}

describe('the same send, three ways', () => {
  it('produces identical outcomes over direct calls, HTTP and the table', async () => {
    life = await createLifecycle();

    // 1. Direct — what the crons and tests use.
    const direct = await handleEngineRequest(life.ctx, {
      kind: 'send',
      requester: PEOPLE.alice.id,
      payload: { recipient: PEOPLE.bob.id, body: BODY },
    });
    expect(direct.ok).toBe(true);

    // 2. HTTP, authenticated with a Supabase-style access token.
    const http = await startHttpTransport(life.ctx, { jwtSecret: JWT_SECRET });
    const token = signSupabaseJwt(
      { sub: PEOPLE.alice.id, exp: Math.floor(life.clock.now().getTime() / 1000) + 3600 },
      JWT_SECRET,
    );
    const overHttp = await postJson(`http://127.0.0.1:${http.port}/send`, token, {
      recipient: PEOPLE.bob.id,
      body: BODY,
    });
    await http.close();
    expect(overHttp.status).toBe(200);
    expect(overHttp.json.ok).toBe(true);

    // 3. Table polling — the launch configuration.
    const overTable = await enqueue(life, 'send', { recipient: PEOPLE.bob.id, body: BODY });
    expect(overTable.ok).toBe(true);
    expect(overTable.requestStatus).toBe('done');

    const a = comparable((direct as { payload: Record<string, unknown> }).payload);
    const b = comparable(overHttp.json.payload as Record<string, unknown>);
    const c = comparable(overTable.payload as Record<string, unknown>);

    expect(b).toEqual(a);
    expect(c).toEqual(a);
    expect(a.route).toBeInstanceOf(Array);
    expect(a.state).toBe('TRANSMITTING');

    // Three transports, three real messages in the database.
    const { rows } = await life.ctx.db.query<{ count: string }>(
      `select count(*)::text as count from public.messages where body = $1`,
      [BODY],
    );
    expect(Number(rows[0]!.count)).toBe(3);
  });

  it('reports the same refusal both ways', async () => {
    life = await createLifecycle();

    const direct = await handleEngineRequest(life.ctx, {
      kind: 'send',
      requester: PEOPLE.alice.id,
      payload: { recipient: PEOPLE.carol.id, body: 'NOT MY FLOCK' },
    });
    expect(direct).toMatchObject({ ok: false, code: 'NOT_FLOCK' });
    expect(statusFor(direct)).toBe(403);

    const overTable = await enqueue(life, 'send', {
      recipient: PEOPLE.carol.id,
      body: 'NOT MY FLOCK',
    });
    expect(overTable.ok).toBe(false);
    expect(overTable.error_code).toBe('NOT_FLOCK');
    expect(overTable.requestStatus).toBe('failed');

    const http = await startHttpTransport(life.ctx, { jwtSecret: JWT_SECRET });
    const token = signSupabaseJwt({ sub: PEOPLE.alice.id }, JWT_SECRET);
    const overHttp = await postJson(`http://127.0.0.1:${http.port}/send`, token, {
      recipient: PEOPLE.carol.id,
      body: 'NOT MY FLOCK',
    });
    await http.close();
    expect(overHttp.status).toBe(403);
    expect(overHttp.json).toMatchObject({ ok: false, code: 'NOT_FLOCK' });
  });

  it('previews identically over the table transport', async () => {
    life = await createLifecycle();
    const direct = await handleEngineRequest(life.ctx, {
      kind: 'preview',
      requester: PEOPLE.alice.id,
      payload: { recipient: PEOPLE.bob.id, body: BODY },
    });
    const overTable = await enqueue(life, 'preview', { recipient: PEOPLE.bob.id, body: BODY });

    const a = (direct as { payload: Record<string, unknown> }).payload;
    const b = overTable.payload as Record<string, unknown>;
    expect(b.route).toEqual(a.route);
    expect(b.totalHours).toEqual(a.totalHours);
    expect(b.noRoute).toEqual(a.noRoute);
    // The token differs only by issue time.
    expect(typeof b.previewToken).toBe('string');
  });
});

describe('the table transport', () => {
  it('leaves nothing pending and is safe to run twice', async () => {
    life = await createLifecycle();
    await enqueue(life, 'preview', { recipient: PEOPLE.bob.id, body: 'AGAIN' });

    expect(await drainEngineRequests(life.ctx)).toBe(0);
    const { rows } = await life.ctx.db.query<{ count: string }>(
      `select count(*)::text as count from public.engine_requests where status = 'pending'`,
    );
    expect(Number(rows[0]!.count)).toBe(0);
  });

  it('answers a malformed request instead of dying on it', async () => {
    life = await createLifecycle();
    const response = await enqueue(life, 'send', { body: 'NO RECIPIENT' });
    expect(response.ok).toBe(false);
    expect(response.error_code).toBe('BAD_REQUEST');
  });

  it('never lets a requester act as somebody else', async () => {
    life = await createLifecycle();
    // The requester column is set by RLS at insert time, so the payload's own
    // idea of who is sending is simply ignored.
    const response = await enqueue(life, 'send', {
      recipient: PEOPLE.bob.id,
      body: 'WHO IS SENDING',
      senderId: PEOPLE.mallory.id,
      sender: PEOPLE.mallory.id,
    });
    expect(response.ok).toBe(true);

    const messageId = (response.payload as { messageId: string }).messageId;
    const message = await getMessage(life.ctx.db, messageId);
    expect(message!.sender).toBe(PEOPLE.alice.id);
  });
});

describe('the HTTP transport', () => {
  it('refuses anonymous and forged callers', async () => {
    life = await createLifecycle();
    const http = await startHttpTransport(life.ctx, { jwtSecret: JWT_SECRET });

    const anonymous = await fetch(`http://127.0.0.1:${http.port}/send`, {
      method: 'POST',
      body: JSON.stringify({ recipient: PEOPLE.bob.id, body: 'HELLO' }),
    });
    expect(anonymous.status).toBe(401);

    const forged = await postJson(
      `http://127.0.0.1:${http.port}/send`,
      signSupabaseJwt({ sub: PEOPLE.alice.id }, 'the-wrong-secret'),
      { recipient: PEOPLE.bob.id, body: 'HELLO' },
    );
    expect(forged.status).toBe(401);

    await http.close();
  });

  it('answers /health without a token', async () => {
    life = await createLifecycle();
    const http = await startHttpTransport(life.ctx, { jwtSecret: JWT_SECRET });
    const response = await fetch(`http://127.0.0.1:${http.port}/health`);
    expect(response.status).toBe(200);
    expect(((await response.json()) as { ok: boolean }).ok).toBe(true);
    await http.close();
  });

  it('404s an unknown endpoint', async () => {
    life = await createLifecycle();
    const http = await startHttpTransport(life.ctx, { jwtSecret: JWT_SECRET });
    const token = signSupabaseJwt({ sub: PEOPLE.alice.id }, JWT_SECRET);
    const response = await postJson(`http://127.0.0.1:${http.port}/deliver`, token, {});
    expect(response.status).toBe(404);
    await http.close();
  });
});

describe('token verification', () => {
  it('accepts only HS256 signatures from the project secret', () => {
    const now = new Date('2026-08-14T12:00:00.000Z');
    const good = signSupabaseJwt({ sub: 'abc', exp: 1_800_000_000 }, JWT_SECRET);
    expect(verifySupabaseJwt(good, JWT_SECRET, now)).toMatchObject({ ok: true, subject: 'abc' });

    expect(verifySupabaseJwt(good, 'other-secret', now)).toMatchObject({
      ok: false,
      reason: 'bad_signature',
    });
    expect(verifySupabaseJwt('nonsense', JWT_SECRET, now)).toMatchObject({
      ok: false,
      reason: 'malformed',
    });
    expect(
      verifySupabaseJwt(signSupabaseJwt({ sub: 'abc', exp: 1 }, JWT_SECRET), JWT_SECRET, now),
    ).toMatchObject({ ok: false, reason: 'expired' });
    expect(
      verifySupabaseJwt(signSupabaseJwt({ exp: 1_800_000_000 }, JWT_SECRET), JWT_SECRET, now),
    ).toMatchObject({ ok: false, reason: 'no_subject' });
  });

  it('rejects the alg:none trick', () => {
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ sub: 'abc' })).toString('base64url');
    expect(
      verifySupabaseJwt(`${header}.${payload}.`, JWT_SECRET, new Date()),
    ).toMatchObject({ ok: false, reason: 'bad_algorithm' });
  });
});

describe('transport selection is configuration', () => {
  it('parses the mode from the environment', () => {
    expect(parseTransportMode(undefined)).toBe('table'); // the launch default
    expect(parseTransportMode('http')).toBe('http');
    expect(parseTransportMode('both')).toBe('both');
    expect(parseTransportMode('none')).toBe('none');
    expect(() => parseTransportMode('carrier-pigeon')).toThrow(/unknown ENGINE_TRANSPORT/);
  });

  it('starts and stops what it was asked for', async () => {
    life = await createLifecycle();
    const running = await startTransports(life.ctx, {
      mode: 'both',
      http: { jwtSecret: JWT_SECRET },
      table: { intervalMs: 60_000 },
    });
    expect(running.http).not.toBeNull();
    expect(running.table).not.toBeNull();
    await running.stop();

    const none = await startTransports(life.ctx, { mode: 'none' });
    expect(none.http).toBeNull();
    expect(none.table).toBeNull();
    await none.stop();
  });

  it('refuses to start HTTP without a JWT secret', async () => {
    life = await createLifecycle();
    await expect(startTransports(life.ctx, { mode: 'http' })).rejects.toThrow(/HTTP options/);
    await expect(
      startTransports(life.ctx, { mode: 'http', http: { jwtSecret: '' } }),
    ).rejects.toThrow(/JWT secret/);
  });
});
