/**
 * Boot guards (REDTEAM F19).
 *
 * `mechanics_config` is tunable at runtime by design, which means a well-meant
 * tuning edit can quietly invalidate an invariant the router depends on. These
 * checks run at startup and *fail the boot* — a silently suboptimal A* is far
 * worse than a service that refuses to start with a clear message.
 */

import { GRID, assertGridMatchesConfig } from '@smoke/shared';
import type { MechanicsConfig } from '@smoke/shared';

export class ConfigInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigInvariantError';
  }
}

/**
 * The smallest time multiplier the config can produce for a single hop.
 *
 * Today that is the best weather times the tailwind floor. When v1.1 relays ship
 * (`relay.mult`, `relay.tend_mult`), they multiply the same product and must be
 * included here — and the heuristic factor must come down with them.
 */
export function minimumAchievableTimeMultiplier(config: MechanicsConfig): number {
  const table = config.get('weather.time_mult');
  const weatherMin = Math.min(
    config.get('weather.unknown_time_mult'),
    // F29 priced never-fetched cells above clear, which cannot lower the floor —
    // but a later tune could, and a heuristic that overestimates costs us optimal
    // routes with no symptom at all. Cheaper to assert than to notice.
    config.get('routing.unknown_cost_mult'),
    ...Object.values(table),
  );
  return weatherMin * config.get('wind.tailwind_min_mult');
}

/**
 * A* is only optimal while its heuristic never overestimates. The heuristic
 * prices the remaining great-circle distance at `heuristic_max_speed_factor`, so
 * that factor must be no larger than the cheapest multiplier any real hop can
 * have (ARCHITECTURE §6.2, REDTEAM F3).
 */
export function assertHeuristicAdmissible(config: MechanicsConfig): void {
  const factor = config.get('routing.heuristic_max_speed_factor');
  const floor = minimumAchievableTimeMultiplier(config);

  if (!(factor <= floor + 1e-12)) {
    throw new ConfigInvariantError(
      `routing.heuristic_max_speed_factor (${factor}) exceeds the smallest achievable ` +
        `time multiplier (${floor}). A* would stop returning optimal routes, silently. ` +
        'Lower the factor to match, or raise the multipliers it is derived from.',
    );
  }
}

/** Every invariant the engine refuses to start without. */
export function assertEngineInvariants(config: MechanicsConfig): void {
  assertGridMatchesConfig(config);
  assertHeuristicAdmissible(config);

  const cap = config.get('message.char_cap');
  if (!Number.isInteger(cap) || cap <= 0) {
    throw new ConfigInvariantError(`message.char_cap must be a positive integer, got ${cap}`);
  }
  if (config.get('speed.base_kmh') <= 0) {
    throw new ConfigInvariantError('speed.base_kmh must be positive');
  }
  if (GRID.cellCount <= 0) {
    throw new ConfigInvariantError('the grid is empty — cell math is misconfigured');
  }
}
