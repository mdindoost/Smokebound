/**
 * Push dispatch, behind an interface.
 *
 * M3 produces the notifications; M6 wires them to Expo Push. Nothing here holds
 * a credential, and the default dispatcher deliberately does nothing — the
 * lifecycle must be fully testable and fully runnable without push set up.
 */

import type { EventKind, Uuid } from '@smoke/shared';

export interface PushMessage {
  /** Recipient of the *notification*, not of the smoke. */
  userId: Uuid;
  kind: EventKind;
  title: string;
  body: string;
  data: Record<string, unknown>;
}

export interface PushDispatcher {
  dispatch(message: PushMessage): Promise<void>;
}

/** The default: notifications are produced, logged, and dropped (M6 wires them). */
export class NoopPushDispatcher implements PushDispatcher {
  constructor(private readonly log: (msg: string) => void = () => {}) {}

  async dispatch(message: PushMessage): Promise<void> {
    this.log(`push[${message.kind}] → ${message.userId}: ${message.title}`);
  }
}

/** Keeps every notification for inspection. Used by tests and local debugging. */
export class RecordingPushDispatcher implements PushDispatcher {
  readonly sent: PushMessage[] = [];

  async dispatch(message: PushMessage): Promise<void> {
    this.sent.push(message);
  }

  kinds(): EventKind[] {
    return this.sent.map((m) => m.kind);
  }

  forUser(userId: Uuid): PushMessage[] {
    return this.sent.filter((m) => m.userId === userId);
  }

  clear(): void {
    this.sent.length = 0;
  }
}
