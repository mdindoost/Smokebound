/**
 * The F19 guard under the night flag (MECHANICS-V2 §4.6, §6.3) and the F39
 * adoption semantics.
 */

import { MechanicsConfig, mechanicsSeedRows } from '@smoke/shared';
import { describe, expect, it, vi } from 'vitest';

import { assertHeuristicAdmissible, minimumAchievableTimeMultiplier } from '../../src/engine/guards.js';
import { ConfigHolder } from '../../src/engine/configHolder.js';

function configWith(overrides: Record<string, unknown>): MechanicsConfig {
  return MechanicsConfig.fromRows(
    mechanicsSeedRows().map((row) => (row.key in overrides ? { ...row, value: overrides[row.key] } : row)),
  );
}

describe('the admissibility floor moves with the flag (§6.3)', () => {
  it('is 0.7 with night off', () => {
    expect(minimumAchievableTimeMultiplier(configWith({ 'night.enabled': false }))).toBeCloseTo(0.7, 9);
  });

  it('is 0.525 with night on', () => {
    const config = configWith({ 'night.enabled': true, 'routing.heuristic_max_speed_factor': 0.525 });
    expect(minimumAchievableTimeMultiplier(config)).toBeCloseTo(0.525, 9);
  });

  it('refuses a config that enables night without lowering the heuristic', () => {
    // The intended failure. A factor of 0.7 against a 0.525 floor is not a
    // crash — it is silently worse routing, which is the whole reason F19
    // exists to convert it into a loud one.
    const config = configWith({ 'night.enabled': true, 'routing.heuristic_max_speed_factor': 0.7 });
    expect(() => assertHeuristicAdmissible(config)).toThrow(/heuristic_max_speed_factor/);
  });

  it('accepts a pessimistic factor with night off', () => {
    // 0.525 while night is off is merely conservative: admissible, slightly
    // slower to search. Only the enabling direction is dangerous, which is why
    // rolling back the flag flip is safe in any order.
    const config = configWith({ 'night.enabled': false, 'routing.heuristic_max_speed_factor': 0.525 });
    expect(() => assertHeuristicAdmissible(config)).not.toThrow();
  });
});

describe('config adoption, not boot (REDTEAM F39)', () => {
  it('adopts a sound snapshot', () => {
    const holder = new ConfigHolder(configWith({}));
    const next = configWith({ 'speed.base_kmh': 40 });
    expect(holder.adopt(next).adopted).toBe(true);
    expect(holder.config.get('speed.base_kmh')).toBe(40);
  });

  it('keeps the last good config when a snapshot fails, and shouts', () => {
    const alert = vi.fn();
    const holder = new ConfigHolder(configWith({}), () => {}, alert);
    const bad = configWith({ 'night.enabled': true, 'routing.heuristic_max_speed_factor': 0.7 });

    const result = holder.adopt(bad);
    expect(result.adopted).toBe(false);
    expect(result.problem).toMatch(/heuristic_max_speed_factor/);
    // The engine goes on running on what it had.
    expect(holder.config.get('night.enabled')).toBe(false);
    expect(alert).toHaveBeenCalledOnce();
  });

  it('adopts a multi-key flip evaluated as a set — the week-2 transaction', () => {
    // §6.2's operator procedure. The three keys are only valid together, which
    // is exactly why they must land in one transaction: the engine judges the
    // snapshot, not the diff.
    const holder = new ConfigHolder(configWith({}));
    const weekTwo = configWith({
      'night.enabled': true,
      'garble.daylight_only': true,
      'routing.heuristic_max_speed_factor': 0.525,
    });
    expect(holder.adopt(weekTwo).adopted).toBe(true);
    expect(holder.config.get('night.enabled')).toBe(true);
  });
});
