/**
 * Tower voices (M5.7 §2).
 */

import { NARRATION_KINDS } from '@smoke/shared';
import { describe, expect, it } from 'vitest';

import { TOWER_VOICE_KINDS, towerVoice } from '../src/lib/towerVoice';

const CELL = 'r037c090'; // Little Falls
const AT = '2026-08-15T04:00:00Z';

const event = (kind: string, payload: Record<string, unknown> = {}) => ({
  kind,
  at: AT,
  payload: { cell: CELL, ...payload },
});

describe('tower voices', () => {
  it('speaks in the first person about its own station', () => {
    const line = towerVoice(event('SIGHTED', { heading_deg: 180 }));
    expect(line).toContain('Little Falls');
    expect(line).toMatch(/south/); // heading 180
  });

  it('has at least three variants for every kind', () => {
    // A three-day flight would otherwise read like one tower with one sentence.
    for (const kind of TOWER_VOICE_KINDS) {
      const lines = new Set<string>();
      for (let i = 0; i < 60; i++) {
        const line = towerVoice({
          kind,
          at: new Date(Date.parse(AT) + i * 3_600_000).toISOString(),
          payload: { cell: CELL, wind_mph: 45, heading_deg: 90 },
        });
        if (line !== null) lines.add(line);
      }
      expect(lines.size).toBeGreaterThanOrEqual(3);
    }
  });

  it('says the same thing every time you look at the same event', () => {
    // The flight view re-renders on every poll and every clock tick; copy that
    // reshuffled per render would be unreadable.
    const first = towerVoice(event('WIND_ROSE', { wind_mph: 48 }));
    for (let i = 0; i < 20; i++) {
      expect(towerVoice(event('WIND_ROSE', { wind_mph: 48 }))).toBe(first);
    }
  });

  it('stays quiet on lifecycle events that already have copy', () => {
    // A tower improvising over "It arrived." would be two voices at once.
    for (const kind of ['SENT', 'DEPARTED', 'DELIVERED', 'LOST', 'STRANDED']) {
      expect(towerVoice(event(kind))).toBeNull();
    }
  });

  it('tells a replan as a decision the stations made', () => {
    const line = towerVoice(event('RESUMED'));
    expect(line).not.toBeNull();
    expect(line).not.toMatch(/state|server|replan/i);
  });

  it('says nothing for a cell with no tower', () => {
    // A station with no name cannot speak in the first person about itself.
    expect(towerVoice({ kind: 'SIGHTED', at: AT, payload: { cell: 'r001c001' } })).toBeNull();
    expect(towerVoice({ kind: 'SIGHTED', at: AT, payload: null })).toBeNull();
  });

  it('covers every narration kind the engine can emit', () => {
    // If the engine gains a kind and the copy does not, the Ledger silently
    // falls back to raw event names.
    for (const kind of NARRATION_KINDS) {
      expect(TOWER_VOICE_KINDS).toContain(kind);
    }
  });
});
