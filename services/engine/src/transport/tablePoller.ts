/**
 * Table-polling transport (ARCHITECTURE §6.4).
 *
 * The beta engine runs on a home server behind NAT: nothing can reach it, so it
 * must be able to work fully outbound. The client inserts into `engine_requests`
 * and subscribes to `engine_responses`; the engine polls, answers, and never
 * needs an inbound port. This is the launch configuration, not a fallback.
 *
 * Authentication is structural rather than cryptographic here: RLS only lets a
 * client insert a row with `requester = auth.uid()`, so the requester column is
 * as trustworthy as a verified JWT — and it cost nothing to verify.
 */

import type { Uuid } from '@smoke/shared';

import type { EngineContext } from '../engine/context.js';
import { REQUEST_KINDS, handleEngineRequest } from './handlers.js';
import type { EngineRequestKind } from './handlers.js';

export interface TablePollerOptions {
  /** How often to look for new requests. Infrastructure, not gameplay. */
  intervalMs?: number;
  /** Requests handled per pass. */
  batchSize?: number;
  /** Re-claim requests abandoned by a crashed worker after this long. */
  staleClaimMs?: number;
}

export interface TablePoller {
  stop(): void;
}

const DEFAULT_INTERVAL_MS = 2_000;
const DEFAULT_BATCH = 20;
const DEFAULT_STALE_CLAIM_MS = 60_000;

interface RequestRow {
  id: Uuid;
  requester: Uuid;
  kind: EngineRequestKind;
  payload: Record<string, unknown> | null;
}

/**
 * Handle one batch of pending requests. Returns how many were processed.
 * Exposed directly so tests can drive the transport without timers.
 */
export async function drainEngineRequests(
  ctx: EngineContext,
  options: TablePollerOptions = {},
): Promise<number> {
  const batchSize = options.batchSize ?? DEFAULT_BATCH;
  const staleClaimMs = options.staleClaimMs ?? DEFAULT_STALE_CLAIM_MS;
  const staleBefore = new Date(ctx.clock.now().getTime() - staleClaimMs).toISOString();

  const { rows } = await ctx.db.query<RequestRow>(
    `update public.engine_requests r
        set claimed_at = now()
      where r.id in (
        select id from public.engine_requests
         where status = 'pending'
           and (claimed_at is null or claimed_at < $2)
         order by created_at
         limit $1
      )
      returning r.id, r.requester, r.kind, r.payload`,
    [batchSize, staleBefore],
  );

  for (const row of rows) {
    const kind = REQUEST_KINDS.includes(row.kind) ? row.kind : ('preview' as EngineRequestKind);
    const reply = await handleEngineRequest(ctx, {
      kind,
      requester: row.requester,
      payload: row.payload ?? {},
    });

    await ctx.db.query(
      `insert into public.engine_responses
         (request_id, requester, ok, payload, error_code, error_message)
       values ($1, $2, $3, $4::jsonb, $5, $6)
       on conflict (request_id) do update
          set ok = excluded.ok,
              payload = excluded.payload,
              error_code = excluded.error_code,
              error_message = excluded.error_message`,
      [
        row.id,
        row.requester,
        reply.ok,
        reply.ok ? JSON.stringify(reply.payload) : JSON.stringify(reply.details ?? {}),
        reply.ok ? null : reply.code,
        reply.ok ? null : reply.message,
      ],
    );

    await ctx.db.query(
      `update public.engine_requests
          set status = $2, completed_at = now()
        where id = $1`,
      [row.id, reply.ok ? 'done' : 'failed'],
    );
  }

  return rows.length;
}

export function startTablePoller(ctx: EngineContext, options: TablePollerOptions = {}): TablePoller {
  const interval = options.intervalMs ?? DEFAULT_INTERVAL_MS;

  const timer = setInterval(() => {
    void drainEngineRequests(ctx, options).catch((err: unknown) => {
      ctx.log(`table transport error: ${(err as Error).message}`);
    });
  }, interval);
  timer.unref?.();

  ctx.log(`table transport polling engine_requests every ${interval} ms`);
  return {
    stop(): void {
      clearInterval(timer);
    },
  };
}
