/**
 * The sun (MECHANICS-V2 §1). Validated against published times, because a model
 * that decides gameplay should agree with the sky people can see.
 */

import { describe, expect, it } from 'vitest';

import { isNight, nextDawn, nextDusk, solarElevationDeg } from './sun.js';

const NYC = { lat: 40.7128, lng: -74.006 };
const DENVER = { lat: 39.7392, lng: -104.9903 };
const CIVIL = -6;

describe('solarElevationDeg', () => {
  it('puts the sun on the horizon at published sunrise', () => {
    // NYC 2026-08-15 sunrise ≈ 06:07 EDT = 10:07 UTC. Sunrise is defined at
    // −0.833° (refraction plus the solar radius), not 0°.
    const elevation = solarElevationDeg(new Date('2026-08-15T10:07:00Z'), NYC);
    expect(elevation).toBeGreaterThan(-2);
    expect(elevation).toBeLessThan(1);
  });

  it('puts the sun high at local noon and below the horizon at local midnight', () => {
    expect(solarElevationDeg(new Date('2026-08-15T16:00:00Z'), NYC)).toBeGreaterThan(50);
    expect(solarElevationDeg(new Date('2026-08-15T05:00:00Z'), NYC)).toBeLessThan(-20);
  });

  it('reaches the same moment in the day later, further west', () => {
    // The terminator is a line sweeping west, not a global switch. Denver is
    // ~30° west of New York, so its dusk is about two hours later.
    const from = new Date('2026-08-15T20:00:00Z');
    const east = nextDusk(from, NYC, CIVIL)!;
    const west = nextDusk(from, DENVER, CIVIL)!;
    const gapHours = (west.getTime() - east.getTime()) / 3_600_000;
    expect(gapHours).toBeGreaterThan(1.5);
    expect(gapHours).toBeLessThan(2.5);
  });
});

describe('isNight', () => {
  it('agrees with published civil twilight to within a few minutes', () => {
    // NYC civil twilight ends ≈ 20:25 EDT = 00:25 UTC on 2026-08-16.
    expect(isNight(new Date('2026-08-16T00:10:00Z'), NYC, CIVIL)).toBe(false);
    expect(isNight(new Date('2026-08-16T00:40:00Z'), NYC, CIVIL)).toBe(true);
  });

  it('calls a summer afternoon day and the small hours night', () => {
    expect(isNight(new Date('2026-08-15T18:00:00Z'), NYC, CIVIL)).toBe(false);
    expect(isNight(new Date('2026-08-15T06:00:00Z'), NYC, CIVIL)).toBe(true);
  });
});

describe('nextDusk / nextDawn', () => {
  it('finds the next crossing in the right direction', () => {
    const from = new Date('2026-08-15T18:00:00Z'); // NYC afternoon
    const dusk = nextDusk(from, NYC, CIVIL)!;
    const dawn = nextDawn(from, NYC, CIVIL)!;

    expect(isNight(new Date(dusk.getTime() - 60_000), NYC, CIVIL)).toBe(false);
    expect(isNight(new Date(dusk.getTime() + 60_000), NYC, CIVIL)).toBe(true);
    expect(dawn.getTime()).toBeGreaterThan(dusk.getTime());
  });

  it('resolves the crossing to the second, not the five-minute scan step', () => {
    const dusk = nextDusk(new Date('2026-08-15T18:00:00Z'), NYC, CIVIL)!;
    expect(isNight(new Date(dusk.getTime() - 2000), NYC, CIVIL)).toBe(false);
    expect(isNight(dusk, NYC, CIVIL)).toBe(true);
  });
});
