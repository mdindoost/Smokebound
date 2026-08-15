/**
 * The dev-only sun override (M5.7 §5) — mostly a test that it cannot ship.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { sunNow, sunOverrideHours } from '../src/lib/devSun';

const REAL = new Date('2026-08-15T18:00:00Z');

afterEach(() => {
  delete process.env['EXPO_PUBLIC_SUN_OFFSET_HOURS'];
  (globalThis as { __DEV__?: boolean }).__DEV__ = undefined;
});

describe('in a production build', () => {
  beforeEach(() => {
    (globalThis as { __DEV__?: boolean }).__DEV__ = false;
  });

  it('ignores the override entirely', () => {
    // The guard is checked before the variable is read, so a test-only
    // affordance cannot be reached even if the variable somehow ships.
    process.env['EXPO_PUBLIC_SUN_OFFSET_HOURS'] = '8';
    expect(sunNow(REAL)).toEqual(REAL);
    expect(sunOverrideHours()).toBeNull();
  });
});

describe('in development', () => {
  beforeEach(() => {
    (globalThis as { __DEV__?: boolean }).__DEV__ = true;
  });

  it('shifts the sun forward so night can be tested at lunchtime', () => {
    process.env['EXPO_PUBLIC_SUN_OFFSET_HOURS'] = '8';
    expect(sunNow(REAL).getTime()).toBe(REAL.getTime() + 8 * 3_600_000);
    expect(sunOverrideHours()).toBe(8);
  });

  it('shifts backwards too', () => {
    process.env['EXPO_PUBLIC_SUN_OFFSET_HOURS'] = '-6';
    expect(sunNow(REAL).getTime()).toBe(REAL.getTime() - 6 * 3_600_000);
  });

  it('is the identity when unset or nonsense', () => {
    expect(sunNow(REAL)).toEqual(REAL);
    process.env['EXPO_PUBLIC_SUN_OFFSET_HOURS'] = 'later';
    expect(sunNow(REAL)).toEqual(REAL);
    process.env['EXPO_PUBLIC_SUN_OFFSET_HOURS'] = '';
    expect(sunNow(REAL)).toEqual(REAL);
  });

  it('never returns a different object when it is not shifting', () => {
    // Callers pass this straight into date maths; a silent copy would be a
    // needless allocation on every render.
    expect(sunNow(REAL)).toBe(REAL);
  });
});
