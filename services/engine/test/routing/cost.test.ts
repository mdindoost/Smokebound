/**
 * Edge-cost arithmetic (MECHANICS §2, §2.2; REDTEAM F11, F12).
 */

import { GRID, MECHANICS_DEFAULTS, formatCellId, haversineKm, cellCenter } from '@smoke/shared';
import { describe, expect, it } from 'vitest';

import { heuristicHours, hopDistanceKm, hopHours, windMultiplier } from '../../src/routing/cost.js';
import { CELLS, CONFIG, clearSky, clearSkyWith, weatherFixture } from '../fixtures/weather.js';

// Observed clear, not merely unobserved — the distinction REDTEAM F29 draws.
const CLEAR = clearSky();

describe('hop distance', () => {
  it('is about one cell orthogonally and 1.414 cells diagonally', () => {
    const from = formatCellId({ row: 30, col: 50 });
    const east = formatCellId({ row: 30, col: 51 });
    const north = formatCellId({ row: 31, col: 50 });
    const diagonal = formatCellId({ row: 31, col: 51 });

    expect(hopDistanceKm(from, north)).toBeCloseTo(GRID.cellKm, 1);
    expect(hopDistanceKm(from, east)).toBeGreaterThan(GRID.cellKm * 0.85);
    expect(hopDistanceKm(from, east)).toBeLessThan(GRID.cellKm * 1.15);

    const ratio = hopDistanceKm(from, diagonal) / hopDistanceKm(from, north);
    expect(ratio).toBeGreaterThan(1.3);
    expect(ratio).toBeLessThan(1.5);
  });
});

describe('weather multipliers act on time, not speed (REDTEAM F11)', () => {
  const from = formatCellId({ row: 30, col: 50 });
  const to = formatCellId({ row: 30, col: 51 });

  it('makes a thunderstorm six times slower, not six times faster', () => {
    const clearHours = hopHours(from, to, CLEAR, CONFIG);
    const stormHours = hopHours(
      from,
      to,
      weatherFixture([[to], { condition: 'thunderstorm' }]),
      CONFIG,
    );
    expect(stormHours).toBeGreaterThan(clearHours);
    expect(stormHours / clearHours).toBeCloseTo(
      MECHANICS_DEFAULTS['weather.time_mult'].thunderstorm,
      6,
    );
  });

  it('orders every condition in the MECHANICS §2.1 table from fast to slow', () => {
    const order = [
      'clear',
      'few_clouds',
      'overcast',
      'fog',
      'drizzle',
      'light_rain',
      'snow',
      'heavy_rain',
      'thunderstorm',
    ] as const;

    const hours = order.map((condition) =>
      hopHours(from, to, weatherFixture([[to], { condition }]), CONFIG),
    );
    for (let i = 1; i < hours.length; i++) {
      expect(hours[i]!).toBeGreaterThanOrEqual(hours[i - 1]!);
    }
  });

  it('prices the cell being entered, not the one being left', () => {
    // Snow painted on an otherwise observed sky: with an empty base the *other*
    // cell would be unknown and priced at routing.unknown_cost_mult, which is a
    // different experiment from the one this test is running.
    const enteringStorm = hopHours(from, to, clearSkyWith([[to], { condition: 'snow' }]), CONFIG);
    const leavingStorm = hopHours(from, to, clearSkyWith([[from], { condition: 'snow' }]), CONFIG);
    expect(enteringStorm).toBeGreaterThan(leavingStorm);
    expect(leavingStorm).toBeCloseTo(hopHours(from, to, CLEAR, CONFIG), 9);
  });

  it('costs exactly base speed under an observed clear sky', () => {
    expect(hopHours(from, to, CLEAR, CONFIG)).toBeCloseTo(
      hopDistanceKm(from, to) / MECHANICS_DEFAULTS['speed.base_kmh'],
      9,
    );
  });

  it('prices a cell missing from the snapshot above clear (REDTEAM F29)', () => {
    // The old assertion here was that an absent cell costs the same as a clear
    // one. That equality was the bug: it made the unexplored sky the cheapest
    // terrain in the graph, and A* went looking for it.
    const unobserved = weatherFixture(); // nothing known anywhere
    const observed = hopHours(from, to, CLEAR, CONFIG);
    const guessed = hopHours(from, to, unobserved, CONFIG);

    expect(guessed).toBeGreaterThan(observed);
    expect(guessed / observed).toBeCloseTo(MECHANICS_DEFAULTS['routing.unknown_cost_mult'], 9);
    // Still crossable, though — F4's fail-open rule is about stranding, and no
    // multiplier may make a cell impassable.
    expect(Number.isFinite(guessed)).toBe(true);
  });

  it('computes from km/h, never from the deprecated mph value (REDTEAM F12)', () => {
    const km = hopDistanceKm(from, to);
    expect(hopHours(from, to, CLEAR, CONFIG)).toBeCloseTo(
      km / CONFIG.get('speed.base_kmh'),
      9,
    );
    // 20 mph is 32.19 km/h, so an mph-derived cost would differ measurably.
    expect(hopHours(from, to, CLEAR, CONFIG)).not.toBeCloseTo(
      km / (MECHANICS_DEFAULTS['speed.base_mph'] * 1.609344),
      6,
    );
  });
});

describe('wind multiplier (MECHANICS §2.2)', () => {
  const tailFloor = MECHANICS_DEFAULTS['wind.tailwind_min_mult'];
  const headCeiling = MECHANICS_DEFAULTS['wind.headwind_max_mult'];

  it('is 1.0 in still air', () => {
    expect(windMultiplier(0, 0, 90, CONFIG)).toBe(1);
  });

  it('speeds up a pure tailwind and slows a pure headwind', () => {
    // Travelling east (90°) with a westerly (wind FROM 270°) is a tailwind.
    expect(windMultiplier(20, 270, 90, CONFIG)).toBeCloseTo(1 - 0.01 * 20, 9);
    // The same wind travelling west (270°) is a headwind.
    expect(windMultiplier(20, 270, 270, CONFIG)).toBeCloseTo(1 + 0.015 * 20, 9);
  });

  it('clamps to [0.7, 1.6]', () => {
    expect(windMultiplier(200, 270, 90, CONFIG)).toBe(tailFloor);
    expect(windMultiplier(200, 270, 270, CONFIG)).toBe(headCeiling);
    for (const speed of [0, 5, 15, 40, 80, 150]) {
      for (const dir of [0, 45, 90, 180, 315]) {
        for (const travel of [0, 30, 120, 200, 350]) {
          const mult = windMultiplier(speed, dir, travel, CONFIG);
          expect(mult).toBeGreaterThanOrEqual(tailFloor);
          expect(mult).toBeLessThanOrEqual(headCeiling);
        }
      }
    }
  });

  it('has no effect from a pure crosswind', () => {
    expect(windMultiplier(30, 180, 90, CONFIG)).toBeCloseTo(1, 9);
    expect(windMultiplier(30, 0, 90, CONFIG)).toBeCloseTo(1, 9);
  });

  it('uses only the along-track component', () => {
    const full = windMultiplier(30, 270, 90, CONFIG);
    const at45 = windMultiplier(30, 270, 45, CONFIG);
    expect(at45).toBeGreaterThan(full); // less help off-axis
    expect(at45).toBeLessThan(1);
  });
});

describe('heuristic admissibility (ARCHITECTURE §6.2, REDTEAM F3)', () => {
  it('never exceeds the cheapest possible real cost', () => {
    const from = CELLS.newark;
    const km = haversineKm(cellCenter(from), cellCenter(CELLS.chicago));
    const fastest = km / (CONFIG.get('speed.base_kmh') / CONFIG.get('wind.tailwind_min_mult'));
    expect(heuristicHours(from, CELLS.chicago, CONFIG)).toBeCloseTo(fastest, 9);
  });

  it('is zero at the destination', () => {
    expect(heuristicHours(CELLS.chicago, CELLS.chicago, CONFIG)).toBe(0);
  });

  it('would be inadmissible if hops were priced at a nominal 50 km', () => {
    // Why `hopDistanceKm` uses the real centre-to-centre distance: cells in the
    // south are ~57 km wide, so a nominal 50 km hop under-counts the ground
    // covered. Summed over an east-west southern route, the "distance" the cost
    // model believes in falls below the great circle the heuristic measures —
    // and with a full tailwind the heuristic then overshoots the true cost.
    const row = 3; // ~25.5°N, southern Florida / Gulf latitude
    const westCol = 60;
    const eastCol = 85;
    const west = formatCellId({ row, col: westCol });
    const east = formatCellId({ row, col: eastCol });

    const hops = eastCol - westCol;
    const nominalKm = hops * GRID.cellKm;
    const realKm = haversineKm(cellCenter(west), cellCenter(east));
    expect(realKm).toBeGreaterThan(nominalKm);

    const floor = CONFIG.get('wind.tailwind_min_mult');
    const base = CONFIG.get('speed.base_kmh');
    const cheapestNominalCost = (nominalKm / base) * floor;
    const heuristic = heuristicHours(west, east, CONFIG);
    expect(heuristic).toBeGreaterThan(cheapestNominalCost); // inadmissible

    // With real distances the same comparison is safe by construction.
    const cheapestRealCost = (realKm / base) * floor;
    expect(heuristic).toBeLessThanOrEqual(cheapestRealCost + 1e-9);
  });
});
