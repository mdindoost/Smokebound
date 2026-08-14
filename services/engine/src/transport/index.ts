/**
 * Which transports run is engine configuration, not a client concern
 * (ARCHITECTURE §6.4).
 *
 *   ENGINE_TRANSPORT=table   (default) fully outbound — the beta setup
 *   ENGINE_TRANSPORT=http    inbound HTTP endpoints
 *   ENGINE_TRANSPORT=both    both at once, e.g. while migrating
 *   ENGINE_TRANSPORT=none    crons only
 */

import type { EngineContext } from '../engine/context.js';
import { startHttpTransport } from './http.js';
import type { HttpTransport, HttpTransportOptions } from './http.js';
import { startTablePoller } from './tablePoller.js';
import type { TablePoller, TablePollerOptions } from './tablePoller.js';

export type TransportMode = 'table' | 'http' | 'both' | 'none';

export interface TransportOptions {
  mode: TransportMode;
  http?: HttpTransportOptions;
  table?: TablePollerOptions;
}

export interface RunningTransports {
  http: HttpTransport | null;
  table: TablePoller | null;
  stop(): Promise<void>;
}

export function parseTransportMode(value: string | undefined): TransportMode {
  switch ((value ?? 'table').toLowerCase()) {
    case 'http':
      return 'http';
    case 'both':
      return 'both';
    case 'none':
      return 'none';
    case 'table':
      return 'table';
    default:
      throw new Error(`unknown ENGINE_TRANSPORT "${value}" (expected table|http|both|none)`);
  }
}

export async function startTransports(
  ctx: EngineContext,
  options: TransportOptions,
): Promise<RunningTransports> {
  const wantsHttp = options.mode === 'http' || options.mode === 'both';
  const wantsTable = options.mode === 'table' || options.mode === 'both';

  if (wantsHttp && !options.http) {
    throw new Error('ENGINE_TRANSPORT includes http but no HTTP options were provided');
  }

  const http = wantsHttp ? await startHttpTransport(ctx, options.http!) : null;
  const table = wantsTable ? startTablePoller(ctx, options.table ?? {}) : null;

  return {
    http,
    table,
    async stop(): Promise<void> {
      table?.stop();
      if (http) await http.close();
    },
  };
}

export { startHttpTransport, startTablePoller };
export { drainEngineRequests } from './tablePoller.js';
export { handleEngineRequest, statusFor, REQUEST_KINDS } from './handlers.js';
export type { EngineReply, EngineRequestEnvelope, EngineRequestKind } from './handlers.js';
export { signSupabaseJwt, verifySupabaseJwt } from './jwt.js';
export type { HttpTransport, HttpTransportOptions, TablePoller, TablePollerOptions };
