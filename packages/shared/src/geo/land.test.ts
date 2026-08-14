import { describe, expect, it } from 'vitest';

import { GRID, cellId, formatCellId, neighbors } from './grid.js';
import {
  LAND_MASK_META,
  LAND_STATS,
  isCoastalWater,
  isForeignLand,
  isLand,
  isTraversable,
  isUsLand,
  terrainOf,
} from './land.js';

/** US places that must be routable. */
const US_PLACES: [string, number, number][] = [
  ['Newark, NJ', 40.7357, -74.1724],
  ['Chicago, IL', 41.8781, -87.6298],
  ['Denver, CO', 39.7392, -104.9903],
  ['Miami, FL', 25.7617, -80.1918],
  ['Seattle, WA', 47.6062, -122.3321],
  ['Detroit, MI', 42.3314, -83.0458],
  ['Buffalo, NY', 42.8864, -78.8784],
  ['Boston, MA', 42.3601, -71.0589],
  ['El Paso, TX', 31.7619, -106.485],
  ['Bangor, ME', 44.8016, -68.7712],
  ['Minneapolis, MN', 44.9778, -93.265],
];

/** Foreign land that v1 must refuse to enter (REDTEAM F16). */
const FOREIGN_PLACES: [string, number, number][] = [
  ['Toronto, ON', 43.6532, -79.3832],
  ['London, ON', 42.9849, -81.2497],
  ['Sudbury, ON', 46.4917, -80.993],
  ['Chihuahua, MX', 28.6353, -106.0889],
  ['Monterrey, MX', 25.6866, -100.3161],
];

/** Open water, far enough offshore that no sample point can touch land. */
const OCEAN_PLACES: [string, number, number][] = [
  ['Atlantic, 400 km east of NJ', 40.0, -69.0],
  ['Atlantic, mid-shelf off the Carolinas', 33.0, -73.0],
  ['Gulf of Mexico, central', 26.0, -90.0],
];

describe('land mask (MECHANICS §1.1)', () => {
  it('was generated against this exact grid, with the border layer', () => {
    expect(LAND_MASK_META.rows).toBe(GRID.rows);
    expect(LAND_MASK_META.cols).toBe(GRID.cols);
    expect(LAND_MASK_META.maskVersion).toBe(2);
    expect(LAND_MASK_META.source).toMatch(/Natural Earth/);
    expect(LAND_MASK_META.source).toMatch(/admin-0/);
  });

  it('marks US cities as US land and routable', () => {
    for (const [name, lat, lng] of US_PLACES) {
      const cell = cellId({ lat, lng });
      expect(isUsLand(cell), `${name} (${cell})`).toBe(true);
      expect(isTraversable(cell), `${name} (${cell})`).toBe(true);
      expect(terrainOf(cell)).toBe('us_land');
    }
  });

  it('marks foreign cities as foreign land and impassable (REDTEAM F16)', () => {
    for (const [name, lat, lng] of FOREIGN_PLACES) {
      const cell = cellId({ lat, lng });
      expect(isForeignLand(cell), `${name} (${cell})`).toBe(true);
      expect(isLand(cell)).toBe(true);
      expect(isUsLand(cell)).toBe(false);
      expect(isTraversable(cell), `${name} (${cell})`).toBe(false);
      expect(terrainOf(cell)).toBe('foreign_land');
    }
  });

  it('marks open ocean as water and non-traversable', () => {
    for (const [name, lat, lng] of OCEAN_PLACES) {
      const cell = cellId({ lat, lng });
      expect(isLand(cell), `${name} (${cell})`).toBe(false);
      expect(isTraversable(cell), `${name} (${cell})`).toBe(false);
    }
  });

  it('never lets foreign land become traversable through adjacency', () => {
    for (let row = 0; row < GRID.rows; row++) {
      for (let col = 0; col < GRID.cols; col++) {
        const cell = formatCellId({ row, col });
        if (isForeignLand(cell)) expect(isTraversable(cell)).toBe(false);
      }
    }
  });

  it('gives every cell exactly one terrain', () => {
    for (let row = 0; row < GRID.rows; row++) {
      for (let col = 0; col < GRID.cols; col++) {
        const cell = formatCellId({ row, col });
        const flags = [isUsLand(cell), isForeignLand(cell), !isLand(cell)].filter(Boolean);
        expect(flags).toHaveLength(1);
      }
    }
  });

  it('keeps a one-cell coastal skirt around US land only', () => {
    for (let row = 0; row < GRID.rows; row++) {
      for (let col = 0; col < GRID.cols; col++) {
        const cell = formatCellId({ row, col });
        if (!isCoastalWater(cell)) continue;
        expect(isLand(cell)).toBe(false);
        expect(neighbors(cell).some(isUsLand), `${cell} touches no US land`).toBe(true);
      }
    }
  });

  it('leaves the ocean and the neighbours unreachable', () => {
    expect(LAND_STATS.totalCells).toBe(GRID.cellCount);
    // The spec expects ~3,200 CONUS land cells (MECHANICS §1).
    expect(LAND_STATS.usLandCells).toBeGreaterThan(3000);
    expect(LAND_STATS.usLandCells).toBeLessThan(3800);
    expect(LAND_STATS.foreignLandCells).toBeGreaterThan(500);
    expect(LAND_STATS.traversableCells).toBeLessThan(LAND_STATS.totalCells);
    expect(LAND_STATS.usLandCells + LAND_STATS.foreignLandCells + LAND_STATS.waterCells).toBe(
      GRID.cellCount,
    );
  });

  it('cannot be crossed: heading east from Newark runs out of world', () => {
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
    for (let col = firstBlockedCol; col < GRID.cols; col++) {
      expect(isTraversable(formatCellId({ row, col })), `r${row}c${col}`).toBe(false);
    }
  });

  it('cannot be crossed northward: the border closes above the northern tier', () => {
    // Walk north from Minneapolis; traversability must end at the border.
    const start = cellId({ lat: 44.9778, lng: -93.265 });
    const col = Number(start.slice(5, 8));
    const startRow = Number(start.slice(1, 4));

    let firstBlockedRow = GRID.rows;
    for (let row = startRow; row < GRID.rows; row++) {
      if (!isTraversable(formatCellId({ row, col }))) {
        firstBlockedRow = row;
        break;
      }
    }
    expect(firstBlockedRow).toBeLessThan(GRID.rows);
    expect(isForeignLand(formatCellId({ row: firstBlockedRow, col }))).toBe(true);
  });
});
