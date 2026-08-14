/**
 * Typed failures for the message API.
 *
 * Note what is *not* here: "no route". A walled-off sky is weather, not an error
 * (REDTEAM F17) — the message is created and strands at its origin. The only
 * things that fail a send are the things the user could have got wrong.
 */

export type EngineErrorCode =
  | 'PROFILE_NOT_FOUND'
  | 'NOT_FLOCK'
  | 'BLOCKED'
  | 'BODY_TOO_LONG'
  | 'BODY_EMPTY'
  | 'RATE_LIMITED'
  | 'INVALID_TOKEN'
  | 'MESSAGE_NOT_FOUND'
  | 'NOT_YOUR_MESSAGE'
  | 'BAD_REQUEST';

export class EngineError extends Error {
  constructor(
    readonly code: EngineErrorCode,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'EngineError';
  }
}

export const notFlock = (): EngineError =>
  new EngineError('NOT_FLOCK', 'You can only send smoke to your flock.');

export const blocked = (): EngineError =>
  // Deliberately identical wording to NOT_FLOCK's spirit: never confirm to a
  // blocked user that they have been blocked (REDTEAM F1).
  new EngineError('BLOCKED', 'You can only send smoke to your flock.');

export const bodyTooLong = (length: number, cap: number): EngineError =>
  new EngineError('BODY_TOO_LONG', `Message is ${length} characters; the cap is ${cap}.`, {
    length,
    cap,
  });

export const rateLimited = (sentToday: number, cap: number): EngineError =>
  new EngineError('RATE_LIMITED', `You have lit ${sentToday} fires today; the limit is ${cap}.`, {
    sentToday,
    cap,
  });
