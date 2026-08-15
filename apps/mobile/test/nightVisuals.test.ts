/**
 * M5.6 — the night the device saw as day.
 *
 * At 2:56 AM local, deep night, an in-flight signal rendered as the daytime
 * smoke ember with smoke copy. These cover each of the three separate causes.
 */

import { cellCenter } from '@smoke/shared';
import { describe, expect, it } from 'vitest';

import { regimeAt, terminatorPath } from '../src/map/NightLayer';
import { crossingsAlong } from '../src/lib/crossings';
import { homeLine, stateBlurb } from '../src/lib/copy';
import type { SegmentEta } from '../src/lib/flight';

const CIVIL = -6;
const NEWARK = 'r037c090';
const DEEP_NIGHT = new Date('2026-08-15T06:56:00Z'); // 2:56 AM EDT

describe('the regime at the reported moment', () => {
  it('is fire at 2:56 AM over New Jersey', () => {
    expect(regimeAt(DEEP_NIGHT, cellCenter(NEWARK), CIVIL, true)).toBe('fire');
  });
});

describe('copy stops calling it smoke after dark', () => {
  it('says the fire is on its way', () => {
    expect(stateBlurb('IN_FLIGHT', false, 'fire')).toBe('Your fire is on its way, tower to tower.');
    expect(stateBlurb('IN_FLIGHT', false, 'smoke')).toBe('Your smoke is on its way.');
  });

  it('still claims nothing about speed (REDTEAM F32)', () => {
    for (const state of ['IN_FLIGHT', 'TRANSMITTING', 'STRANDED']) {
      expect(stateBlurb(state, false, 'fire')).not.toMatch(/faster|sooner|quick/i);
    }
  });

  it('describes a home fire as burning at night', () => {
    expect(homeLine(NEWARK, true)).toBe('fire burning near Little Falls');
    expect(homeLine(NEWARK, false)).toBe('fire near Little Falls');
  });
});

describe('the terminator', () => {
  it('crosses a region that spans the boundary', () => {
    // At 01:30 UTC the line lies over the middle of the country.
    const points = terminatorPath(new Date('2026-08-16T01:30:00Z'), CIVIL, {
      minLat: 30,
      maxLat: 48,
      minLng: -120,
      maxLng: -70,
    });
    expect(points.length).toBeGreaterThan(5);
    // It should run roughly north–south, not wander across the whole map.
    const lngs = points.map((p) => p.lng);
    expect(Math.max(...lngs) - Math.min(...lngs)).toBeLessThan(20);
  });

  it('returns nothing when the whole view is in one regime', () => {
    const points = terminatorPath(new Date('2026-08-15T18:00:00Z'), CIVIL, {
      minLat: 40,
      maxLat: 41,
      minLng: -75,
      maxLng: -74,
    });
    expect(points).toEqual([]);
  });
});

describe('Ledger crossings (DESIGN.md V7)', () => {
  const segments: SegmentEta[] = [
    { leg: 0, cell: 'r037c090', cumulative_hours: 0, eta: '2026-08-15T22:00:00Z' },
    { leg: 1, cell: 'r037c089', cumulative_hours: 2, eta: '2026-08-16T00:00:00Z' },
    { leg: 2, cell: 'r037c088', cumulative_hours: 4, eta: '2026-08-16T02:00:00Z' },
  ];

  it('reports a dusk the engine has confirmed the smoke flew through', () => {
    const crossings = crossingsAlong(segments, ['r037c090', 'r037c089', 'r037c088'], CIVIL);
    expect(crossings.length).toBeGreaterThan(0);
    expect(crossings[0]!.into).toBe('night');
    expect(crossings[0]!.line).toMatch(/Dusk/);
  });

  it('never narrates a crossing the engine has not confirmed', () => {
    // The arithmetic is available for the whole route; the rule is that only
    // confirmed legs may be spoken about.
    expect(crossingsAlong(segments, ['r037c090'], CIVIL)).toEqual([]);
  });

  it('says nothing at all without segment ETAs', () => {
    expect(crossingsAlong(null, ['r037c090'], CIVIL)).toEqual([]);
  });
});
