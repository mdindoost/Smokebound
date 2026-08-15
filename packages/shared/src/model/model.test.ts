import { describe, expect, it } from 'vitest';

import { EVENT_KINDS,
  MESSAGE_STATES,
  MESSAGE_TRANSITIONS,
  TERMINAL_MESSAGE_STATES,
  canTransition,
  flockPair,
  isTerminalState, NARRATION_KINDS } from './index.js';
import type { MessageState } from './index.js';

describe('message state machine (ARCHITECTURE §4)', () => {
  it('has exactly the five states in the schema CHECK constraint', () => {
    expect([...MESSAGE_STATES].sort()).toEqual(
      ['DELIVERED', 'IN_FLIGHT', 'LOST', 'STRANDED', 'TRANSMITTING'].sort(),
    );
  });

  it('encodes the documented transitions and nothing else', () => {
    expect(canTransition('TRANSMITTING', 'IN_FLIGHT')).toBe(true);
    expect(canTransition('IN_FLIGHT', 'STRANDED')).toBe(true);
    expect(canTransition('STRANDED', 'IN_FLIGHT')).toBe(true);
    expect(canTransition('STRANDED', 'LOST')).toBe(true);
    expect(canTransition('IN_FLIGHT', 'DELIVERED')).toBe(true);

    // v1 has no spontaneous loss: only stranding can kill a message (MECHANICS §6.3).
    expect(canTransition('IN_FLIGHT', 'LOST')).toBe(false);
    expect(canTransition('TRANSMITTING', 'DELIVERED')).toBe(false);
    expect(canTransition('TRANSMITTING', 'STRANDED')).toBe(false);
    expect(canTransition('STRANDED', 'DELIVERED')).toBe(false);
  });

  it('treats DELIVERED and LOST as terminal', () => {
    for (const state of MESSAGE_STATES) {
      const terminal = TERMINAL_MESSAGE_STATES.includes(state);
      expect(isTerminalState(state)).toBe(terminal);
      expect(MESSAGE_TRANSITIONS[state].length === 0).toBe(terminal);
    }
  });

  it('never lists an unknown target state', () => {
    for (const targets of Object.values(MESSAGE_TRANSITIONS)) {
      for (const t of targets) expect(MESSAGE_STATES).toContain(t);
    }
  });

  it('can reach every state from TRANSMITTING', () => {
    const seen = new Set<MessageState>(['TRANSMITTING']);
    const queue: MessageState[] = ['TRANSMITTING'];
    while (queue.length) {
      for (const next of MESSAGE_TRANSITIONS[queue.pop()!]) {
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
    expect(seen.size).toBe(MESSAGE_STATES.length);
  });
});

describe('events', () => {
  it('matches the kinds listed in the schema comment', () => {
    expect(EVENT_KINDS).toEqual([
      // Lifecycle: what happened to the message.
      'SENT',
      'DEPARTED',
      'STRANDED',
      'RESUMED',
      'GARBLED',
      'DELIVERED',
      'LOST',
      // Tower voices (M5.7 §2): what the stations saw. Narration only.
      'SIGHTED',
      'WIND_ROSE',
      'WIND_EASED',
      'FOG_SET_IN',
      'SKY_CLEARED',
    ]);
  });

  it('keeps narration kinds a strict subset of the event kinds', () => {
    // The migration's check constraint and this union have to agree, or the
    // engine writes an event Postgres refuses.
    for (const kind of NARRATION_KINDS) {
      expect(EVENT_KINDS).toContain(kind);
    }
    // Narration carries no mechanics: nothing in the lifecycle set may appear.
    expect(NARRATION_KINDS).not.toContain('DELIVERED');
    expect(NARRATION_KINDS).not.toContain('LOST');
  });
});

describe('flockPair (composite key ordering)', () => {
  const x = '00000000-0000-4000-8000-000000000001';
  const y = 'ffffffff-0000-4000-8000-000000000002';

  it('always stores with a < b regardless of argument order', () => {
    expect(flockPair(x, y)).toEqual({ a: x, b: y });
    expect(flockPair(y, x)).toEqual({ a: x, b: y });
    expect(flockPair(x, y).a < flockPair(x, y).b).toBe(true);
  });
});
