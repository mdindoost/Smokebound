/**
 * Talking to the engine (ARCHITECTURE §6.4).
 *
 * Two transports behind one interface. The **table** transport is the launch
 * configuration: the client inserts a row into `engine_requests` and waits for
 * the matching `engine_responses` row over realtime, so the engine can live on a
 * home server behind NAT and never accept an inbound connection. The **HTTP**
 * transport is the same contract for a future hosted deployment.
 *
 * Which one runs is configuration, not a screen's business — every caller sees
 * `EngineTransport`.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import { EngineRequestError } from './engineTypes';
import type { EngineReply, EngineRequestKind } from './engineTypes';

export interface EngineTransport {
  request<T>(kind: EngineRequestKind, payload: Record<string, unknown>): Promise<T>;
}

/** How long to wait for the engine before telling the user the fire is cold. */
const DEFAULT_TIMEOUT_MS = 45_000;
/** Realtime is the fast path; this poll is the one that always works. */
const POLL_INTERVAL_MS = 1_500;

interface ResponseRow {
  ok: boolean;
  payload: Record<string, unknown> | null;
  error_code: string | null;
  error_message: string | null;
}

function unwrap<T>(row: ResponseRow): T {
  if (row.ok) return row.payload as T;
  throw new EngineRequestError(
    row.error_code ?? 'INTERNAL',
    row.error_message ?? 'The fire went out. Try again.',
    row.payload ?? {},
  );
}

export interface TableTransportOptions {
  timeoutMs?: number;
  pollIntervalMs?: number;
}

export class TableTransport implements EngineTransport {
  constructor(
    private readonly supabase: SupabaseClient,
    private readonly options: TableTransportOptions = {},
  ) {}

  async request<T>(kind: EngineRequestKind, payload: Record<string, unknown>): Promise<T> {
    // `requester` also defaults to auth.uid() in the schema, but sending it
    // explicitly keeps the intent readable — and RLS refuses the row either way
    // if it does not match the caller.
    const { data: session } = await this.supabase.auth.getSession();
    const requester = session.session?.user.id;
    if (requester === undefined) throw new EngineRequestError('UNAUTHORIZED', 'Sign in first.');

    const { data, error } = await this.supabase
      .from('engine_requests')
      .insert({ kind, payload, requester })
      .select('id')
      .single();

    if (error) throw new EngineRequestError('TRANSPORT', error.message);
    const requestId = (data as { id: string }).id;

    const row = await this.awaitResponse(requestId);
    return unwrap<T>(row);
  }

  /** Realtime first, polling underneath it, and a deadline over both. */
  private async awaitResponse(requestId: string): Promise<ResponseRow> {
    const timeoutMs = this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const pollMs = this.options.pollIntervalMs ?? POLL_INTERVAL_MS;

    const existing = await this.fetchResponse(requestId);
    if (existing) return existing;

    return new Promise<ResponseRow>((resolve, reject) => {
      let settled = false;

      const finish = (row: ResponseRow): void => {
        if (settled) return;
        settled = true;
        clearInterval(poller);
        clearTimeout(deadline);
        void this.supabase.removeChannel(channel);
        resolve(row);
      };

      const channel = this.supabase
        .channel(`engine-response-${requestId}`)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'engine_responses',
            filter: `request_id=eq.${requestId}`,
          },
          (message: { new: ResponseRow }) => finish(message.new),
        )
        .subscribe();

      const poller = setInterval(() => {
        void this.fetchResponse(requestId).then((row) => {
          if (row) finish(row);
        });
      }, pollMs);

      const deadline = setTimeout(() => {
        if (settled) return;
        settled = true;
        clearInterval(poller);
        void this.supabase.removeChannel(channel);
        reject(
          new EngineRequestError(
            'TIMEOUT',
            'The engine did not answer. Your signal may still be lit — check the Ledger.',
          ),
        );
      }, timeoutMs);
    });
  }

  private async fetchResponse(requestId: string): Promise<ResponseRow | null> {
    const { data } = await this.supabase
      .from('engine_responses')
      .select('ok, payload, error_code, error_message')
      .eq('request_id', requestId)
      .maybeSingle();
    return (data as ResponseRow | null) ?? null;
  }
}

export interface HttpTransportOptions {
  baseUrl: string;
  /** Supplies the current Supabase access token. */
  accessToken: () => Promise<string | null>;
  timeoutMs?: number;
}

export class HttpTransport implements EngineTransport {
  constructor(private readonly options: HttpTransportOptions) {}

  async request<T>(kind: EngineRequestKind, payload: Record<string, unknown>): Promise<T> {
    const token = await this.options.accessToken();
    if (token === null) throw new EngineRequestError('UNAUTHORIZED', 'Sign in first.');

    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    );

    try {
      const response = await fetch(`${this.options.baseUrl}/${kind}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      const body = (await response.json()) as EngineReply<T>;
      if (body.ok) return body.payload;
      throw new EngineRequestError(body.code, body.message, body.details);
    } catch (err) {
      if (err instanceof EngineRequestError) throw err;
      throw new EngineRequestError('TRANSPORT', (err as Error).message);
    } finally {
      clearTimeout(timer);
    }
  }
}
