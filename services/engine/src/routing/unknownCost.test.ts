/**
 * REDTEAM F29: the unexplored sky must be crossable, never inviting.
 */

import { MechanicsConfig, mechanicsSeedRows } from '@smoke/shared';
import { describe, expect, it } from 'vitest';

import { cellMultipliers, hopHours } from './cost.js';
import { snapshotFrom } from '../weather/types.js';

const config: MechanicsConfig = MechanicsConfig.fromRows(mechanicsSeedRows());
const EMPTY = snapshotFrom([]);

describe('unknown terrain pricing', () => {
  it('prices a never-fetched cell above clear', () => {
    const { weatherMult, unknown } = cellMultipliers('r037c090', 180, EMPTY, config);
    expect(unknown).toBe(true);
    expect(weatherMult).toBe(config.get('routing.unknown_cost_mult'));
    expect(weatherMult).toBeGreaterThan(config.get('weather.time_mult').clear);
  });

  it('leaves the fail-open stranding rule alone', () => {
    // F4 lives on: unknown weather is never impassable, whatever it costs.
    expect(config.get('weather.unknown_time_mult')).toBe(1.0);
  });

  it('makes an unexplored hop cost more than a known clear one', () => {
    // The whole bug in one assertion: before F29 these were equal, so A* had a
    // positive incentive to leave the terrain it had actually looked at.
    const known = snapshotFrom([
      {
        cell: 'r036c090',
        condition: 'clear',
        timeMult: config.get('weather.time_mult').clear,
        windMph: 0,
        windDirFromDeg: 0,
        impassable: false,
        weatherUnknown: false,
        source: 'nws',
        fetchedAt: new Date(),
      },
    ]);
    const explored = hopHours('r037c090', 'r036c090', known, config);
    const unexplored = hopHours('r037c090', 'r036c090', EMPTY, config);
    expect(unexplored).toBeGreaterThan(explored);
  });
});
