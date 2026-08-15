/**
 * Night traversal and its interactions (MECHANICS-V2 §2, §3; REDTEAM F32–F35).
 *
 * The §7.2 property obligations, executable.
 */

import { MechanicsConfig, cellCenter, isNight, mechanicsSeedRows } from '@smoke/shared';
import { describe, expect, it } from 'vitest';

import { hopHours, nightMultiplier } from '../../src/routing/cost.js';
import { planRoute } from '../../src/routing/astar.js';
import { CELLS, CONFIG, clearSky, clearSkyWith, weatherFixture } from '../fixtures/weather.js';

/** The seeded config with the night mechanic switched on. */
function nightOn(overrides: Record<string, unknown> = {}): MechanicsConfig {
  const rows = mechanicsSeedRows().map((row) =>
    row.key === 'night.enabled'
      ? { ...row, value: true }
      : row.key === 'routing.heuristic_max_speed_factor'
        ? { ...row, value: 0.525 } // §4.6: must move with the flag
        : row.key in overrides
          ? { ...row, value: overrides[row.key] }
          : row,
  );
  return MechanicsConfig.fromRows(rows);
}

const FROM = 'r037c090';
const TO = 'r036c090';
// 04:00 UTC is the small hours in New Jersey; 18:00 UTC is mid-afternoon.
const NIGHT_AT = new Date('2026-08-16T04:00:00Z');
const DAY_AT = new Date('2026-08-15T18:00:00Z');

describe('night traversal', () => {
  it('is exactly v1 when the flag is off', () => {
    // Flag isolation (§7.2): with night.enabled false, every cost is what it was.
    const day = hopHours(FROM, TO, clearSky(), CONFIG, DAY_AT);
    const night = hopHours(FROM, TO, clearSky(), CONFIG, NIGHT_AT);
    const timeless = hopHours(FROM, TO, clearSky(), CONFIG);
    expect(night).toBe(day);
    expect(night).toBe(timeless);
  });

  it('makes a clear night hop faster than the same hop by day', () => {
    const config = nightOn();
    const day = hopHours(FROM, TO, clearSky(), config, DAY_AT);
    const night = hopHours(FROM, TO, clearSky(), config, NIGHT_AT);
    expect(night).toBeLessThan(day);
    expect(night / day).toBeCloseTo(config.get('night.time_mult'), 9);
  });

  it('never makes night slower — the inversion tripwire (REDTEAM F11)', () => {
    // Multipliers applied to speed rather than time would flip this, which is
    // exactly the bug F11 caught once already.
    const config = nightOn();
    for (const condition of ['clear', 'overcast', 'fog', 'thunderstorm'] as const) {
      const sky = clearSkyWith([[TO], { condition }]);
      expect(hopHours(FROM, TO, sky, config, NIGHT_AT)).toBeLessThanOrEqual(
        hopHours(FROM, TO, sky, config, DAY_AT),
      );
    }
  });

  it('prices the sun of the cell being entered, not some global clock', () => {
    const config = nightOn();
    // 01:30 UTC: full dark in New Jersey (sun 16.8° below the horizon), still
    // daylight in Colorado (4.1° above it). The terminator is a line sweeping
    // west across the map, not a switch the whole country shares.
    const at = new Date('2026-08-16T01:30:00Z');
    expect(isNight(at, cellCenter('r037c090'), config.get('night.twilight_elevation_deg'))).toBe(true);
    expect(isNight(at, cellCenter('r035c035'), config.get('night.twilight_elevation_deg'))).toBe(false);
    expect(nightMultiplier('r037c090', at, clearSky(), config)).toBe(config.get('night.time_mult'));
    expect(nightMultiplier('r035c035', at, clearSky(), config)).toBe(1);
  });
});

describe('the blinding set (MECHANICS-V2 §3.3)', () => {
  const config = nightOn();

  it('denies the bonus in every blinding condition', () => {
    for (const condition of config.get('night.blinding_conditions')) {
      const sky = clearSkyWith([[TO], { condition }]);
      expect(nightMultiplier(TO, NIGHT_AT, sky, config)).toBe(1);
    }
  });

  it('grants it in every other condition', () => {
    const blinding = new Set(config.get('night.blinding_conditions'));
    for (const condition of ['clear', 'few_clouds', 'overcast', 'drizzle', 'light_rain'] as const) {
      if (blinding.has(condition)) continue;
      const sky = clearSkyWith([[TO], { condition }]);
      expect(nightMultiplier(TO, NIGHT_AT, sky, config)).toBe(config.get('night.time_mult'));
    }
  });

  it('keeps fog blinding and light rain not, though fog costs less time', () => {
    // The §3.2 point: visibility and speed are different axes. No threshold on
    // time_mult could separate these two, which is why the set is a list.
    expect(config.get('weather.time_mult').fog).toBeLessThan(config.get('weather.time_mult').light_rain);
    expect(nightMultiplier(TO, NIGHT_AT, clearSkyWith([[TO], { condition: 'fog' }]), config)).toBe(1);
    expect(
      nightMultiplier(TO, NIGHT_AT, clearSkyWith([[TO], { condition: 'light_rain' }]), config),
    ).toBe(config.get('night.time_mult'));
  });

  it('gives a never-fetched cell the bonus (REDTEAM F34)', () => {
    // Unknown prices like overcast under F29, and overcast is not blinding.
    // Denying it would be F29's own bias with the sign flipped.
    expect(nightMultiplier(TO, NIGHT_AT, weatherFixture(), config)).toBe(
      config.get('night.time_mult'),
    );
  });
});

describe('a whole route', () => {
  it('is never slower flown at night than by day, all else equal', () => {
    const config = nightOn();
    const sky = clearSky();
    const byDay = planRoute({
      origin: CELLS.newark,
      dest: CELLS.philadelphia,
      weather: sky,
      config,
      departAt: DAY_AT,
    });
    const byNight = planRoute({
      origin: CELLS.newark,
      dest: CELLS.philadelphia,
      weather: sky,
      config,
      departAt: NIGHT_AT,
    });
    if (byDay.status !== 'OK' || byNight.status !== 'OK') throw new Error('expected routes');
    expect(byNight.totalHours).toBeLessThanOrEqual(byDay.totalHours);
  });
});
