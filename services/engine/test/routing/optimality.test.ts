/**
 * Properties the router must hold on arbitrary weather, not just fixtures
 * (ARCHITECTURE §9):
 *
 *  - A* returns the same cost as plain Dijkstra → the heuristic is admissible.
 *  - Total hours never decrease when the weather gets worse → monotonic in
 *    severity, which is what makes "the storm delayed it" an honest statement.
 */

import { formatCellId, parseCellId } from '@smoke/shared';
import type { CellId, WeatherCondition } from '@smoke/shared';
import { describe, expect, it } from 'vitest';

import { planRoute } from '../../src/routing/astar.js';
import { snapshotFrom } from '../../src/weather/types.js';
import type { CellWeather, WeatherSnapshot } from '../../src/weather/types.js';
import { dijkstra } from '../reference/dijkstra.js';
import { CELLS, CONFIG, FIXED_TIME, cellWeather } from '../fixtures/weather.js';

/** Deterministic PRNG so a failing seed can be replayed. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

/** Conditions ordered from fastest to slowest (MECHANICS §2.1). */
const SEVERITY: WeatherCondition[] = [
  'clear',
  'few_clouds',
  'overcast',
  'fog',
  'drizzle',
  'light_rain',
  'snow',
  'heavy_rain',
  'thunderstorm',
];

interface FieldOptions {
  seed: number;
  rows: [number, number];
  cols: [number, number];
  /** Probability a cell carries an active severe warning. */
  impassableChance?: number;
  maxSeverity?: number;
}

function randomField(options: FieldOptions): Map<CellId, CellWeather> {
  const rand = lcg(options.seed);
  const maxSeverity = options.maxSeverity ?? SEVERITY.length - 1;
  const field = new Map<CellId, CellWeather>();

  for (let row = options.rows[0]; row <= options.rows[1]; row++) {
    for (let col = options.cols[0]; col <= options.cols[1]; col++) {
      const cell = formatCellId({ row, col });
      const impassable = rand() < (options.impassableChance ?? 0);
      const condition = SEVERITY[Math.floor(rand() * (maxSeverity + 1))]!;
      field.set(
        cell,
        cellWeather(cell, {
          condition,
          impassable,
          windMph: Math.floor(rand() * 60),
          windDirFromDeg: Math.floor(rand() * 360),
        }),
      );
    }
  }
  return field;
}

const asSnapshot = (field: Map<CellId, CellWeather>): WeatherSnapshot =>
  snapshotFrom(field.values());

describe('A* agrees with Dijkstra on random weather (admissible heuristic)', () => {
  const seeds = [1, 2, 3, 5, 8, 13, 21, 34];

  for (const seed of seeds) {
    it(`seed ${seed}: identical total hours`, () => {
      const field = randomField({ seed, rows: [30, 45], cols: [60, 95] });
      const weather = asSnapshot(field);

      const astar = planRoute({
        origin: CELLS.newark,
        dest: CELLS.chicago,
        weather,
        config: CONFIG,
      });
      const reference = dijkstra(CELLS.newark, CELLS.chicago, weather, CONFIG);

      if (astar.status === 'NO_ROUTE') {
        expect(reference.totalHours).toBeNull();
        return;
      }
      expect(reference.totalHours).not.toBeNull();
      expect(astar.totalHours).toBeCloseTo(reference.totalHours!, 9);
    });
  }

  it('agrees even when severe cells wall off large regions', () => {
    for (const seed of [7, 11, 19]) {
      const field = randomField({
        seed,
        rows: [30, 45],
        cols: [60, 95],
        impassableChance: 0.25,
      });
      const weather = asSnapshot(field);
      const astar = planRoute({ origin: CELLS.newark, dest: CELLS.chicago, weather, config: CONFIG });
      const reference = dijkstra(CELLS.newark, CELLS.chicago, weather, CONFIG);

      if (astar.status === 'NO_ROUTE') {
        expect(reference.totalHours, `seed ${seed}`).toBeNull();
      } else {
        expect(astar.totalHours, `seed ${seed}`).toBeCloseTo(reference.totalHours!, 9);
      }
    }
  });

  it('expands far fewer cells than the reference search', () => {
    const weather = asSnapshot(randomField({ seed: 42, rows: [30, 45], cols: [60, 95] }));
    const astar = planRoute({ origin: CELLS.newark, dest: CELLS.chicago, weather, config: CONFIG });
    if (astar.status !== 'OK') throw new Error('expected a route');
    // Guided search should not be exploring the whole continent.
    expect(astar.expanded).toBeLessThan(2000);
  });
});

describe('total hours are monotonically non-decreasing in weather severity', () => {
  const baseSeeds = [4, 9, 16, 25];

  for (const seed of baseSeeds) {
    it(`seed ${seed}: worsening cells never speeds a message up`, () => {
      const field = randomField({ seed, rows: [30, 45], cols: [60, 95], maxSeverity: 4 });
      const before = planRoute({
        origin: CELLS.newark,
        dest: CELLS.chicago,
        weather: asSnapshot(field),
        config: CONFIG,
      });
      if (before.status !== 'OK') throw new Error('expected a route');

      const rand = lcg(seed * 7919);
      const cells = [...field.keys()];
      const worsened = new Map(field);

      for (let i = 0; i < 40; i++) {
        const cell = cells[Math.floor(rand() * cells.length)]!;
        const current = worsened.get(cell)!;
        const index = SEVERITY.indexOf(current.condition);
        const next = SEVERITY[Math.min(SEVERITY.length - 1, index + 1 + Math.floor(rand() * 3))]!;
        worsened.set(cell, {
          ...current,
          condition: next,
          timeMult: CONFIG.timeMultFor(next),
          // Wind is left alone: this property is about the weather multiplier.
          fetchedAt: FIXED_TIME,
        });
      }

      const after = planRoute({
        origin: CELLS.newark,
        dest: CELLS.chicago,
        weather: asSnapshot(worsened),
        config: CONFIG,
      });
      if (after.status !== 'OK') throw new Error('expected a route');
      expect(after.totalHours).toBeGreaterThanOrEqual(before.totalHours - 1e-9);
    });
  }

  it('adding severe warnings can only slow a message or strand it', () => {
    const field = randomField({ seed: 99, rows: [30, 45], cols: [60, 95], maxSeverity: 3 });
    const before = planRoute({
      origin: CELLS.newark,
      dest: CELLS.chicago,
      weather: asSnapshot(field),
      config: CONFIG,
    });
    if (before.status !== 'OK') throw new Error('expected a route');

    const rand = lcg(4242);
    const blocked = new Map(field);
    for (const cell of blocked.keys()) {
      if (rand() < 0.15) blocked.set(cell, { ...blocked.get(cell)!, impassable: true });
    }

    const after = planRoute({
      origin: CELLS.newark,
      dest: CELLS.chicago,
      weather: asSnapshot(blocked),
      config: CONFIG,
    });
    if (after.status === 'NO_ROUTE') {
      expect(after.reason).toBeDefined();
      return;
    }
    expect(after.totalHours).toBeGreaterThanOrEqual(before.totalHours - 1e-9);
  });

  it('is strictly slower when the whole corridor worsens', () => {
    const corridorCells: CellId[] = [];
    for (let row = 35; row <= 42; row++) {
      for (let col = 60; col <= 95; col++) corridorCells.push(formatCellId({ row, col }));
    }

    let previous = 0;
    for (const condition of ['clear', 'overcast', 'light_rain', 'snow', 'heavy_rain'] as const) {
      const weather = snapshotFrom(corridorCells.map((cell) => cellWeather(cell, { condition })));
      const result = planRoute({
        origin: CELLS.newark,
        dest: CELLS.chicago,
        weather,
        config: CONFIG,
      });
      if (result.status !== 'OK') throw new Error('expected a route');
      expect(result.totalHours).toBeGreaterThan(previous);
      previous = result.totalHours;
    }
  });

  it('keeps every route inside the grid', () => {
    const weather = asSnapshot(randomField({ seed: 77, rows: [30, 45], cols: [60, 95] }));
    const result = planRoute({ origin: CELLS.newark, dest: CELLS.chicago, weather, config: CONFIG });
    if (result.status !== 'OK') throw new Error('expected a route');
    for (const cell of result.route) {
      const { row, col } = parseCellId(cell);
      expect(row).toBeGreaterThanOrEqual(0);
      expect(col).toBeGreaterThanOrEqual(0);
    }
  });
});
