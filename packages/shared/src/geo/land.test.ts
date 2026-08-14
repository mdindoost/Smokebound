import { describe, expect, it } from 'vitest';

import { GRID, cellId, formatCellId, neighbors } from './grid.js';
import { LAND_MASK_META, LAND_STATS, isCoastalWater, isLand, isTraversable } from './land.js';

/** Places that must be land, with the cell they fall in. */
const LAND_PLACES: [string, number, number][] = [
  ['Newark, NJ', 40.7357, -74.1724],
  ['Chicago, IL', 41.8781, -87.6298],
  ['Denver, CO', 39.7392, -104.9903],
  ['Miami, FL', 25.7617, -80.1918],
  ['Seattle, WA', 47.6062, -122.3321],
  ['Kansas City, MO', 39.0997, -94.5786],
  ['Pittsburgh, PA', 40.4406, -79.9959],
  ['El Paso, TX', 31.7619, -106.485],
  ['Bangor, ME', 44.8016, -68.7712],
];

/** Open water, far enough offshore that no sample point can touch land. */
const OCEAN_PLACES: [string, number, number][] = [
  ['Atlantic, 400 km east of NJ', 40.0, -69.0],
  ['Atlantic, mid-shelf off the Carolinas', 33.0, -73.0],
  ['Gulf of Mexico, central', 26.0, -90.0],
  ['Pacific, 300 km west of California', 36.0, -125.0 + 0.6],
];

describe('land mask (MECHANICS §1.1)', () => {
  it('was generated against this exact grid', () => {
    expect(LAND_MASK_META.rows).toBe(GRID.rows);
    expect(LAND_MASK_META.cols).toBe(GRID.cols);
    expect(LAND_MASK_META.gridSignature).toContain(`${GRID.rows}x${GRID.cols}`);
    expect(LAND_MASK_META.source).toMatch(/Natural Earth/);
  });

  it('marks major cities as land', () => {
    for (const [name, lat, lng] of LAND_PLACES) {
      const cell = cellId({ lat, lng });
      expect(isLand(cell), `${name} (${cell})`).toBe(true);
      expect(isTraversable(cell), `${name} (${cell})`).toBe(true);
    }
  });

  it('marks open ocean as water and non-traversable', () => {
    for (const [name, lat, lng] of OCEAN_PLACES) {
      const cell = cellId({ lat, lng });
      expect(isLand(cell), `${name} (${cell})`).toBe(false);
      expect(isTraversable(cell), `${name} (${cell})`).toBe(false);
    }
  });

  it('keeps a one-cell coastal skirt around land', () => {
    // The cell immediately east of Miami is water, but reachable.
    const miami = cellId({ lat: 25.7617, lng: -80.1918 });
    const offshore = neighbors(miami).filter((c) => !isLand(c));
    expect(offshore.length).toBeGreaterThan(0);
    for (const cell of offshore) {
      expect(isTraversable(cell)).toBe(true);
      expect(isCoastalWater(cell)).toBe(true);
    }
  });

  it('never marks a land cell as coastal water', () => {
    for (let row = 0; row < GRID.rows; row++) {
      for (let col = 0; col < GRID.cols; col++) {
        const cell = formatCellId({ row, col });
        if (isLand(cell)) expect(isCoastalWater(cell)).toBe(false);
        if (isCoastalWater(cell)) expect(isTraversable(cell)).toBe(true);
      }
    }
  });

  it('makes every traversable water cell touch land', () => {
    for (let row = 0; row < GRID.rows; row++) {
      for (let col = 0; col < GRID.cols; col++) {
        const cell = formatCellId({ row, col });
        if (!isTraversable(cell) || isLand(cell)) continue;
        expect(neighbors(cell).some(isLand)).toBe(true);
      }
    }
  });

  it('leaves a substantial open ocean that smoke can never enter', () => {
    expect(LAND_STATS.totalCells).toBe(GRID.cellCount);
    expect(LAND_STATS.landCells).toBeGreaterThan(3000);
    expect(LAND_STATS.openOceanCells).toBeGreaterThan(500);
    expect(LAND_STATS.traversableCells).toBe(LAND_STATS.totalCells - LAND_STATS.openOceanCells);
  });

  it('cannot be crossed: heading east from Newark runs out of world', () => {
    // Long Island keeps the coastal skirt going for a few cells, then the
    // Atlantic closes the door — the eastern edge of that row is unreachable.
    const start = cellId({ lat: 40.7357, lng: -74.1724 });
    const row = Number(start.slice(1, 4));
    const startCol = Number(start.slice(5, 8));

    let firstBlockedCol = GRID.cols;
    for (let col = startCol; col < GRID.cols; col++) {
      if (!isTraversable(formatCellId({ row, col }))) {
        firstBlockedCol = col;
        break;
      }
    }
    expect(firstBlockedCol).toBeLessThan(startCol + 12);

    // Everything from there to the eastern edge stays open ocean.
    for (let col = firstBlockedCol; col < GRID.cols; col++) {
      expect(isTraversable(formatCellId({ row, col })), `r${row}c${col}`).toBe(false);
    }
  });
});
