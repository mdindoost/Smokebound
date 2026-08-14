/**
 * Boot guards (REDTEAM F19). These exist because `mechanics_config` is tunable
 * at runtime: a tuning edit must not be able to break A* optimality silently.
 */

import { MechanicsConfig, mechanicsSeedRows } from '@smoke/shared';
import { describe, expect, it } from 'vitest';

import {
  ConfigInvariantError,
  assertEngineInvariants,
  assertHeuristicAdmissible,
  minimumAchievableTimeMultiplier,
} from '../../src/engine/guards.js';
import { CONFIG } from '../fixtures/weather.js';

const rows = mechanicsSeedRows();

function configWith(overrides: Record<string, unknown>): MechanicsConfig {
  return MechanicsConfig.fromRows(
    rows.map((row) => (row.key in overrides ? { key: row.key, value: overrides[row.key] } : row)),
  );
}

describe('assertHeuristicAdmissible', () => {
  it('accepts the shipped config', () => {
    expect(() => assertHeuristicAdmissible(CONFIG)).not.toThrow();
    expect(() => assertEngineInvariants(CONFIG)).not.toThrow();
  });

  it('computes the floor as the best weather times the tailwind floor', () => {
    expect(minimumAchievableTimeMultiplier(CONFIG)).toBeCloseTo(
      CONFIG.get('wind.tailwind_min_mult'),
      9,
    );
  });

  it('refuses to boot when the heuristic is tuned optimistic', () => {
    // A *larger* factor prices the remaining distance higher — that is the
    // direction that overestimates and breaks optimality.
    const config = configWith({ 'routing.heuristic_max_speed_factor': 0.9 });
    expect(() => assertHeuristicAdmissible(config)).toThrow(ConfigInvariantError);
    expect(() => assertHeuristicAdmissible(config)).toThrow(/optimal routes, silently/);
  });

  it('allows a more conservative heuristic, which is merely slower', () => {
    expect(() =>
      assertHeuristicAdmissible(configWith({ 'routing.heuristic_max_speed_factor': 0.5 })),
    ).not.toThrow();
  });

  it('refuses to boot when the wind floor is raised without the heuristic', () => {
    // Raising the tailwind floor to 0.8 makes the 0.7 heuristic... still safe.
    expect(() => assertHeuristicAdmissible(configWith({ 'wind.tailwind_min_mult': 0.8 }))).not.toThrow();
    // Lowering it to 0.6 means real hops can be cheaper than the heuristic assumes.
    expect(() => assertHeuristicAdmissible(configWith({ 'wind.tailwind_min_mult': 0.6 }))).toThrow(
      ConfigInvariantError,
    );
  });

  it('accounts for a weather multiplier tuned below 1.0', () => {
    const table = { ...CONFIG.get('weather.time_mult'), clear: 0.9 };
    expect(() => assertHeuristicAdmissible(configWith({ 'weather.time_mult': table }))).toThrow(
      ConfigInvariantError,
    );
  });
});

describe('assertEngineInvariants', () => {
  it('rejects a nonsensical character cap', () => {
    expect(() => assertEngineInvariants(configWith({ 'message.char_cap': 0 }))).toThrow(
      /char_cap/,
    );
  });

  it('rejects a non-positive base speed', () => {
    expect(() => assertEngineInvariants(configWith({ 'speed.base_kmh': 0 }))).toThrow(
      /base_kmh/,
    );
  });

  it('rejects a config that silently re-grids the world', () => {
    expect(() => assertEngineInvariants(configWith({ 'grid.cell_km': 25 }))).toThrow(
      /persisted identifiers/,
    );
  });
});
