/**
 * M5.6 punch list: framing, tower density, breathing ember.
 */

import { describe, expect, it } from 'vitest';

import { MAX_TOWER_MARKS, marksForZoom, thinTowers } from '../src/map/towerDensity';
import type { Tower } from '../src/map/towerDensity';
import { emberBreathAt, emberRadiusFor } from '../src/design/motion';

const route = (n: number): Tower[] =>
  Array.from({ length: n }, (_, i) => ({ cell: `r0${30 + (i % 9)}c${100 + i}`, name: `T${i}` }));

describe('tower density is gated on zoom (R22)', () => {
  it('shows more when zoomed into a town than across a continent', () => {
    expect(marksForZoom(0.5)).toBeGreaterThan(marksForZoom(30));
  });

  it('keeps the continental case sparse enough not to read as a fence', () => {
    // A dozen evenly spaced identical triangles is a *pattern*, and a pattern
    // outweighs the single ember it exists to frame.
    expect(marksForZoom(40)).toBeLessThanOrEqual(MAX_TOWER_MARKS);
    expect(thinTowers(route(60), marksForZoom(40)).length).toBeLessThanOrEqual(MAX_TOWER_MARKS);
  });

  it('falls back to the default before the first camera report', () => {
    expect(marksForZoom(null)).toBe(MAX_TOWER_MARKS);
  });

  it('still keeps both ends at every zoom', () => {
    const long = route(60);
    for (const delta of [0.5, 3, 8, 40]) {
      const thinned = thinTowers(long, marksForZoom(delta));
      expect(thinned[0]).toEqual(long[0]);
      expect(thinned.at(-1)).toEqual(long.at(-1));
    }
  });
});

describe('the breathing ember scales with the view (R23)', () => {
  it('grows with the visible span, so the breath reads the same at any zoom', () => {
    expect(emberRadiusFor(40)).toBeGreaterThan(emberRadiusFor(1));
  });

  it('never collapses to nothing when zoomed all the way in', () => {
    expect(emberRadiusFor(0.01)).toBeGreaterThanOrEqual(1500);
  });

  it('has a sane default before the camera has reported', () => {
    expect(emberRadiusFor(null)).toBeGreaterThan(0);
  });

  it('swells and fades over the cycle', () => {
    const quarter = emberBreathAt(0.25);
    const threeQuarter = emberBreathAt(0.75);
    expect(quarter.scale).toBeGreaterThan(threeQuarter.scale);
    // Dimmest at full swell, brightest when drawn in — a fire drawing air.
    expect(quarter.alpha).toBeLessThan(threeQuarter.alpha);
  });

  it('holds still under reduce-motion rather than breathing slowly', () => {
    // Someone who asked the system to stop moving things asked for that, not
    // for a compromise.
    const a = emberBreathAt(0.1, true);
    const b = emberBreathAt(0.9, true);
    expect(a).toEqual(b);
    expect(a.scale).toBe(1);
  });
});
