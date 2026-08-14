/**
 * One set of handlers, two transports (ARCHITECTURE §6.4).
 *
 * Everything below is transport-neutral: it takes a requester id and a payload
 * and returns a reply. The HTTP server and the table-polling worker are thin
 * shells around this, which is what makes the parity test meaningful — there is
 * only one implementation to be right or wrong.
 */

import type { Uuid } from '@smoke/shared';

import type { EngineContext } from '../engine/context.js';
import { EngineError } from '../messages/errors.js';
import { previewMessage, resendMessage, sendMessage } from '../messages/send.js';

export type EngineRequestKind = 'preview' | 'send' | 'resend';

export const REQUEST_KINDS: readonly EngineRequestKind[] = ['preview', 'send', 'resend'];

export interface EngineRequestEnvelope {
  kind: EngineRequestKind;
  requester: Uuid;
  payload: Record<string, unknown>;
}

export type EngineReply =
  | { ok: true; payload: Record<string, unknown> }
  | { ok: false; code: string; message: string; details?: Record<string, unknown> };

function requireString(payload: Record<string, unknown>, field: string): string {
  const value = payload[field];
  if (typeof value !== 'string' || value.length === 0) {
    throw new EngineError('BAD_REQUEST', `"${field}" is required`);
  }
  return value;
}

function optionalString(payload: Record<string, unknown>, field: string): string | undefined {
  const value = payload[field];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new EngineError('BAD_REQUEST', `"${field}" must be a string`);
  return value;
}

export async function handleEngineRequest(
  ctx: EngineContext,
  envelope: EngineRequestEnvelope,
): Promise<EngineReply> {
  try {
    const { kind, requester, payload } = envelope;

    switch (kind) {
      case 'preview': {
        const result = await previewMessage(ctx, {
          senderId: requester,
          recipientId: requireString(payload, 'recipient'),
          body: requireString(payload, 'body'),
        });
        return { ok: true, payload: result as unknown as Record<string, unknown> };
      }
      case 'send': {
        const result = await sendMessage(ctx, {
          senderId: requester,
          recipientId: requireString(payload, 'recipient'),
          body: requireString(payload, 'body'),
          previewToken: optionalString(payload, 'preview_token'),
        });
        return { ok: true, payload: result as unknown as Record<string, unknown> };
      }
      case 'resend': {
        const result = await resendMessage(ctx, {
          senderId: requester,
          messageId: requireString(payload, 'message_id'),
        });
        return { ok: true, payload: result as unknown as Record<string, unknown> };
      }
      default:
        return { ok: false, code: 'BAD_REQUEST', message: `unknown request kind "${kind}"` };
    }
  } catch (err) {
    if (err instanceof EngineError) {
      return { ok: false, code: err.code, message: err.message, details: err.details };
    }
    ctx.log(`engine request failed: ${(err as Error).stack ?? String(err)}`);
    return { ok: false, code: 'INTERNAL', message: 'The fire went out. Try again.' };
  }
}

/** HTTP status for a reply code — the table transport ignores this. */
export function statusFor(reply: EngineReply): number {
  if (reply.ok) return 200;
  switch (reply.code) {
    case 'BAD_REQUEST':
    case 'BODY_EMPTY':
    case 'BODY_TOO_LONG':
    case 'INVALID_TOKEN':
      return 400;
    case 'NOT_FLOCK':
    case 'BLOCKED':
    case 'NOT_YOUR_MESSAGE':
      return 403;
    case 'PROFILE_NOT_FOUND':
    case 'MESSAGE_NOT_FOUND':
      return 404;
    case 'RATE_LIMITED':
      return 429;
    default:
      return 500;
  }
}
