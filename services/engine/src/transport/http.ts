/**
 * HTTP transport (ARCHITECTURE §6.4).
 *
 * A thin shell over `handleEngineRequest`: authenticate the caller from their
 * Supabase access token, parse JSON, answer. Useful when the engine is reachable
 * — for the beta it will not be (see `tablePoller.ts`).
 */

import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';

import type { EngineContext } from '../engine/context.js';
import { REQUEST_KINDS, handleEngineRequest, statusFor } from './handlers.js';
import type { EngineRequestKind } from './handlers.js';
import { verifySupabaseJwt } from './jwt.js';

export interface HttpTransportOptions {
  /** Supabase JWT secret (Project Settings → API → JWT Settings). */
  jwtSecret: string;
  port?: number;
  host?: string;
  /** Reject bodies larger than this many bytes. */
  maxBodyBytes?: number;
}

export interface HttpTransport {
  port: number;
  close(): Promise<void>;
}

const DEFAULT_MAX_BODY = 64 * 1024;

async function readBody(req: IncomingMessage, limit: number): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) throw new Error('request body too large');
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(text);
}

export async function startHttpTransport(
  ctx: EngineContext,
  options: HttpTransportOptions,
): Promise<HttpTransport> {
  if (!options.jwtSecret) {
    throw new Error('HTTP transport requires the Supabase JWT secret to authenticate callers');
  }
  const maxBody = options.maxBodyBytes ?? DEFAULT_MAX_BODY;

  const server: Server = createServer((req, res) => {
    void (async () => {
      try {
        const url = new URL(req.url ?? '/', 'http://localhost');
        const path = url.pathname.replace(/\/+$/, '') || '/';

        if (req.method === 'GET' && path === '/health') {
          json(res, 200, { ok: true, at: ctx.clock.now().toISOString() });
          return;
        }

        const kind = path.slice(1) as EngineRequestKind;
        if (req.method !== 'POST' || !REQUEST_KINDS.includes(kind)) {
          json(res, 404, { ok: false, code: 'NOT_FOUND', message: 'No such endpoint.' });
          return;
        }

        const auth = req.headers['authorization'];
        const token = typeof auth === 'string' && auth.startsWith('Bearer ') ? auth.slice(7) : '';
        const verified = token
          ? verifySupabaseJwt(token, options.jwtSecret, ctx.clock.now())
          : ({ ok: false, reason: 'malformed' } as const);
        if (!verified.ok) {
          json(res, 401, { ok: false, code: 'UNAUTHORIZED', message: 'Sign in first.' });
          return;
        }

        const raw = await readBody(req, maxBody);
        let payload: Record<string, unknown>;
        try {
          payload = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
        } catch {
          json(res, 400, { ok: false, code: 'BAD_REQUEST', message: 'Body must be JSON.' });
          return;
        }

        const reply = await handleEngineRequest(ctx, {
          kind,
          requester: verified.subject,
          payload,
        });
        json(res, statusFor(reply), reply);
      } catch (err) {
        ctx.log(`http transport error: ${(err as Error).message}`);
        json(res, 500, { ok: false, code: 'INTERNAL', message: 'The fire went out.' });
      }
    })();
  });

  await new Promise<void>((resolve) => {
    server.listen(options.port ?? 0, options.host ?? '127.0.0.1', resolve);
  });

  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : (options.port ?? 0);
  ctx.log(`http transport listening on ${options.host ?? '127.0.0.1'}:${port}`);

  return {
    port,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
