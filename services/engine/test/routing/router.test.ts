/**
 * A* behaviour against the storm fixtures ARCHITECTURE §9 calls for:
 * wall, pocket, full blockade — plus the ocean rule (MECHANICS §1.1).
 */

import { areNeighbors, cellsAlongGreatCircle, isLand, isTraversable, parseCellId } from '@smoke/shared';
import { describe, expect, it } from 'vitest';

import { planRoute, toSegmentEtas } from '../../src/routing/astar.js';
import { CELLS, CONFIG, cellRect, clearSky, colOf, rowOf, weatherFixture } from '../fixtures/weather.js';

// A sky we have actually looked at. Before REDTEAM F29 an empty snapshot served
// as "clear", which is what let unexplored terrain price like good weather.
const CLEAR = clearSky();

/** Wall down column 81 (western PA), north of the corridor. */
const WALL_COLUMN = 81;
const STORM_WALL = cellRect([36, 56], [WALL_COLUMN, WALL_COLUMN]);

describe('clear skies reproduce the MECHANICS §7 worked examples', () => {
  it('Newark → Chicago ≈ 36 h', () => {
    const result = planRoute({ origin: CELLS.newark, dest: CELLS.chicago, weather: CLEAR, config: CONFIG });
    expect(result.status).toBe('OK');
    if (result.status !== 'OK') return;
    expect(result.totalHours).toBeGreaterThan(34);
    expect(result.totalHours).toBeLessThan(38);
    expect(result.route[0]).toBe(CELLS.newark);
    expect(result.route.at(-1)).toBe(CELLS.chicago);
  });

  it('Newark → Philadelphia ≈ 4 h', () => {
    const result = planRoute({
      origin: CELLS.newark,
      dest: CELLS.philadelphia,
      weather: CLEAR,
      config: CONFIG,
    });
    expect(result.status).toBe('OK');
    if (result.status !== 'OK') return;
    expect(result.totalHours).toBeGreaterThan(3);
    expect(result.totalHours).toBeLessThan(5.5);
  });

  it('returns a contiguous route with monotonically increasing waypoint times', () => {
    const result = planRoute({ origin: CELLS.newark, dest: CELLS.chicago, weather: CLEAR, config: CONFIG });
    if (result.status !== 'OK') throw new Error('expected a route');

    for (let i = 1; i < result.route.length; i++) {
      expect(areNeighbors(result.route[i - 1]!, result.route[i]!)).toBe(true);
    }
    expect(result.waypoints[0]!.cumulativeHours).toBe(0);
    for (let i = 1; i < result.waypoints.length; i++) {
      expect(result.waypoints[i]!.cumulativeHours).toBeGreaterThan(
        result.waypoints[i - 1]!.cumulativeHours,
      );
    }
    expect(result.waypoints.at(-1)!.cumulativeHours).toBeCloseTo(result.totalHours, 9);
    expect(new Set(result.route).size).toBe(result.route.length);
  });

  it('converts waypoints to the segment_etas shape the schema stores', () => {
    const result = planRoute({ origin: CELLS.newark, dest: CELLS.chicago, weather: CLEAR, config: CONFIG });
    if (result.status !== 'OK') throw new Error('expected a route');

    const departedAt = new Date('2026-08-14T12:00:00.000Z');
    const etas = toSegmentEtas(result.waypoints, departedAt);
    expect(etas[0]!.eta).toBe(departedAt.toISOString());
    expect(new Date(etas.at(-1)!.eta).getTime() - departedAt.getTime()).toBeCloseTo(
      result.totalHours * 3_600_000,
      -1,
    );
    expect(etas.map((e) => e.leg)).toEqual(result.waypoints.map((w) => w.leg));
  });

  it('is deterministic', () => {
    const a = planRoute({ origin: CELLS.newark, dest: CELLS.chicago, weather: CLEAR, config: CONFIG });
    const b = planRoute({ origin: CELLS.newark, dest: CELLS.chicago, weather: CLEAR, config: CONFIG });
    expect(a).toEqual(b);
  });
});

describe('storm wall: the southern detour (SPEC §6.1, MECHANICS §7A)', () => {
  const clearRoute = planRoute({
    origin: CELLS.newark,
    dest: CELLS.chicago,
    weather: CLEAR,
    config: CONFIG,
  });

  it('routes around an impassable severe-weather wall', () => {
    const weather = weatherFixture([STORM_WALL, { impassable: true }]);
    const result = planRoute({ origin: CELLS.newark, dest: CELLS.chicago, weather, config: CONFIG });
    if (result.status !== 'OK' || clearRoute.status !== 'OK') throw new Error('expected routes');

    expect(result.route.some((cell) => STORM_WALL.includes(cell))).toBe(false);
    // It goes *south* — under the wall, the WV/OH valley of the worked example.
    const southmost = Math.min(...result.route.map(rowOf));
    expect(southmost).toBeLessThan(36);
    expect(result.totalHours).toBeGreaterThan(clearRoute.totalHours);
    expect(result.totalHours).toBeLessThan(clearRoute.totalHours * 1.5);
  });

  it('routes around a thunderstorm wall on cost alone, without it being impassable', () => {
    // REDTEAM F2: an ordinary thunderstorm is 6.0x slow but passable. REDTEAM F11:
    // if the multiplier were applied to speed instead of time, the router would
    // dive straight into the storm because it would look six times faster.
    const weather = weatherFixture([STORM_WALL, { condition: 'thunderstorm' }]);
    const result = planRoute({ origin: CELLS.newark, dest: CELLS.chicago, weather, config: CONFIG });
    if (result.status !== 'OK') throw new Error('expected a route');

    expect(result.route.some((cell) => STORM_WALL.includes(cell))).toBe(false);
    expect(Math.min(...result.route.map(rowOf))).toBeLessThan(36);
  });

  it('does not slip diagonally through the corner of a wall', () => {
    const weather = weatherFixture([STORM_WALL, { impassable: true }]);
    const result = planRoute({ origin: CELLS.newark, dest: CELLS.chicago, weather, config: CONFIG });
    if (result.status !== 'OK') throw new Error('expected a route');

    for (let i = 1; i < result.route.length; i++) {
      const from = parseCellId(result.route[i - 1]!);
      const to = parseCellId(result.route[i]!);
      if (from.row === to.row || from.col === to.col) continue;
      const sides = [
        { row: from.row, col: to.col },
        { row: to.row, col: from.col },
      ].map((rc) => `r${String(rc.row).padStart(3, '0')}c${String(rc.col).padStart(3, '0')}`);
      const blocked = sides.filter((cell) => STORM_WALL.includes(cell));
      expect(blocked.length).toBeLessThan(2);
    }
  });
});

describe('storm pocket: entered when cheap, avoided when dear', () => {
  // A wall with a door in it. Going through the door is the short way; going
  // around the southern end of the wall is the long way. Which one wins is
  // purely a question of what the weather in the door costs.
  const DOOR = cellRect([38, 39], [WALL_COLUMN, WALL_COLUMN]);
  const WALL_WITH_DOOR = cellRect([34, 56], [WALL_COLUMN, WALL_COLUMN]).filter(
    (cell) => !DOOR.includes(cell),
  );

  const routeThroughDoor = (condition: 'overcast' | 'light_rain' | 'thunderstorm') => {
    const weather = weatherFixture([WALL_WITH_DOOR, { impassable: true }], [DOOR, { condition }]);
    const result = planRoute({ origin: CELLS.newark, dest: CELLS.chicago, weather, config: CONFIG });
    if (result.status !== 'OK') throw new Error(`expected a route for ${condition}`);
    return { result, usedDoor: result.route.some((cell) => DOOR.includes(cell)) };
  };

  it('takes the short way through a mildly overcast pocket', () => {
    const { usedDoor } = routeThroughDoor('overcast');
    expect(usedDoor).toBe(true);
  });

  it('still takes it through light rain', () => {
    const { usedDoor } = routeThroughDoor('light_rain');
    expect(usedDoor).toBe(true);
  });

  it('goes the long way round rather than cross a thunderstorm pocket', () => {
    const { result, usedDoor } = routeThroughDoor('thunderstorm');
    expect(usedDoor).toBe(false);
    expect(Math.min(...result.route.map(rowOf))).toBeLessThan(34);
  });

  it('prices the two choices consistently: the avoided route is the cheaper one', () => {
    const mild = routeThroughDoor('overcast');
    const severe = routeThroughDoor('thunderstorm');
    expect(severe.result.totalHours).toBeGreaterThan(mild.result.totalHours);
  });
});

describe('full blockade', () => {
  it('returns NO_ROUTE when severe weather spans the grid', () => {
    const blockade = cellRect([0, 56], [WALL_COLUMN, WALL_COLUMN]);
    const weather = weatherFixture([blockade, { impassable: true }]);
    const result = planRoute({ origin: CELLS.newark, dest: CELLS.chicago, weather, config: CONFIG });
    expect(result.status).toBe('NO_ROUTE');
    if (result.status !== 'NO_ROUTE') return;
    expect(result.reason).toBe('no_path');
    expect(result.expanded).toBeGreaterThan(0);
  });

  it('returns NO_ROUTE when the destination itself is under a severe warning', () => {
    const weather = weatherFixture([[CELLS.chicago], { impassable: true }]);
    const result = planRoute({ origin: CELLS.newark, dest: CELLS.chicago, weather, config: CONFIG });
    expect(result.status).toBe('NO_ROUTE');
    if (result.status !== 'NO_ROUTE') return;
    expect(result.reason).toBe('dest_unreachable');
  });

  it('still departs from an origin under a severe warning', () => {
    // A fire under a storm still lights; whether it can move is the next cell's
    // problem, and that is what STRANDED means (MECHANICS §6.1).
    const weather = weatherFixture([[CELLS.newark], { impassable: true }]);
    const result = planRoute({ origin: CELLS.newark, dest: CELLS.chicago, weather, config: CONFIG });
    expect(result.status).toBe('OK');
  });

  it('handles a same-cell send', () => {
    const result = planRoute({ origin: CELLS.newark, dest: CELLS.newark, weather: CLEAR, config: CONFIG });
    expect(result.status).toBe('OK');
    if (result.status !== 'OK') return;
    expect(result.route).toEqual([CELLS.newark]);
    expect(result.totalHours).toBe(0);
  });
});

describe('the ocean rule (MECHANICS §1.1, REDTEAM F13)', () => {
  it('never routes Newark → Miami through open water, though the great circle does', () => {
    const straightLine = cellsAlongGreatCircle(CELLS.newark, CELLS.miami);
    const offshore = straightLine.filter((cell) => !isTraversable(cell));
    expect(offshore.length).toBeGreaterThan(5); // the direct line really does go to sea

    const result = planRoute({ origin: CELLS.newark, dest: CELLS.miami, weather: CLEAR, config: CONFIG });
    if (result.status !== 'OK') throw new Error('expected a route');
    for (const cell of result.route) {
      expect(isTraversable(cell), `${cell} is open ocean`).toBe(true);
    }
  });

  it('detours inland, not out to sea, when the coast is stormed in', () => {
    // Block the Carolina coastal corridor. Under fail-open the Atlantic would be
    // "clear" and therefore the cheapest way past — the land mask is the only
    // thing stopping the smoke from sailing around the storm.
    const coastalStorm = cellRect([18, 21], [76, 82]);
    const weather = weatherFixture([coastalStorm, { impassable: true }]);
    const result = planRoute({ origin: CELLS.newark, dest: CELLS.miami, weather, config: CONFIG });
    if (result.status !== 'OK') throw new Error('expected a route');

    const throughTheGap = result.route.filter((cell) => rowOf(cell) >= 18 && rowOf(cell) <= 21);
    expect(throughTheGap.length).toBeGreaterThan(0);
    for (const cell of throughTheGap) {
      expect(colOf(cell)).toBeLessThan(76); // inland, west of the storm
      expect(isTraversable(cell)).toBe(true);
    }
  });

  it('mostly stays over land, using the coastal skirt only where it must', () => {
    const result = planRoute({ origin: CELLS.newark, dest: CELLS.miami, weather: CLEAR, config: CONFIG });
    if (result.status !== 'OK') throw new Error('expected a route');
    // Hugging the eastern seaboard means some hops sit on the coastal skirt —
    // that is the point of the skirt — but the route is land-dominated.
    const landCells = result.route.filter(isLand).length;
    expect(landCells / result.route.length).toBeGreaterThanOrEqual(0.75);
  });
});

describe('unknown weather is reported, not hidden', () => {
  it('lists route cells whose weather we are guessing', () => {
    // An empty snapshot, not `CLEAR`: since REDTEAM F29 those are different skies,
    // and this test is about the one we have never looked at.
    const unobserved = weatherFixture();
    const result = planRoute({
      origin: CELLS.newark,
      dest: CELLS.chicago,
      weather: unobserved,
      config: CONFIG,
    });
    if (result.status !== 'OK') throw new Error('expected a route');
    expect(result.unknownCells).toEqual(result.route);
  });

  it('drops cells from the list once real weather arrives', () => {
    const result = planRoute({ origin: CELLS.newark, dest: CELLS.chicago, weather: CLEAR, config: CONFIG });
    if (result.status !== 'OK') throw new Error('expected a route');

    const observed = weatherFixture([result.route, { condition: 'clear' }]);
    const second = planRoute({
      origin: CELLS.newark,
      dest: CELLS.chicago,
      weather: observed,
      config: CONFIG,
    });
    if (second.status !== 'OK') throw new Error('expected a route');
    expect(second.unknownCells).toEqual([]);
  });
});
