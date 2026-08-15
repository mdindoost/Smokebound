/**
 * Theater and physics agree about the sky (REDTEAM F32, MECHANICS-V2 §7.2).
 */

import { cellCenter, isNight, mechanicsSeedRows } from '@smoke/shared';
import { describe, expect, it } from 'vitest';

import { regimeAt, regimeInCell, regimeLine } from '../src/map/NightLayer';

const CIVIL = -6;
const NIGHT = new Date('2026-08-16T04:00:00Z'); // small hours in New Jersey
const DAY = new Date('2026-08-15T18:00:00Z');
const NEWARK = 'r037c090';

describe('the map and the router read the same sun', () => {
  it('draws fire exactly when the shared model says it is night', () => {
    // The obligation is agreement with `isNight`, not agreement with a second
    // implementation — there is only one, which is the point of F32.
    for (const at of [NIGHT, DAY, new Date('2026-08-16T00:30:00Z')]) {
      const dark = isNight(at, cellCenter(NEWARK), CIVIL);
      expect(regimeInCell(at, NEWARK, CIVIL, true)).toBe(dark ? 'fire' : 'smoke');
    }
  });

  it('agrees regardless of whether the mechanic is switched on', () => {
    // F32: the shared-definition test asserts state agreement *independently of
    // the mechanics flags*. Theater may run ahead of physics; it may not
    // disagree with it about what time it is.
    for (const mechanicsOn of [true, false]) {
      expect(regimeAt(NIGHT, cellCenter(NEWARK), CIVIL, true)).toBe('fire');
      expect(regimeLine('fire', mechanicsOn)).toContain('fire');
    }
  });

  it('draws smoke everywhere when visuals are off', () => {
    expect(regimeAt(NIGHT, cellCenter(NEWARK), CIVIL, false)).toBe('smoke');
  });
});

describe('copy may describe a fire, but not claim speed (REDTEAM F32)', () => {
  it('says nothing about speed while the mechanic is off', () => {
    const line = regimeLine('fire', false);
    expect(line).toMatch(/fire/i);
    expect(line).not.toMatch(/faster|sooner|quick|speed/i);
  });

  it('may say the far towers see it sooner once the mechanic is on', () => {
    expect(regimeLine('fire', true)).toMatch(/sooner/);
  });

  it('never claims anything about fire during the day', () => {
    for (const on of [true, false]) {
      expect(regimeLine('smoke', on)).not.toMatch(/fire|faster|sooner/i);
    }
  });
});

describe('the shipped defaults', () => {
  it('ship visuals on and the mechanic off', () => {
    const rows = new Map(mechanicsSeedRows().map((row) => [row.key, row.value]));
    expect(rows.get('night.visuals_enabled')).toBe(true);
    expect(rows.get('night.enabled')).toBe(false);
    expect(rows.get('garble.daylight_only')).toBe(false);
    expect(rows.get('counsel.enabled')).toBe(false);
  });

  it('ships the week-1 baseline heuristic factor', () => {
    const rows = new Map(mechanicsSeedRows().map((row) => [row.key, row.value]));
    expect(rows.get('routing.heuristic_max_speed_factor')).toBe(0.7);
  });
});
