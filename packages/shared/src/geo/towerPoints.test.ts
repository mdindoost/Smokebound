/**
 * Tower pins have to land on the ground people actually live on.
 *
 * The bug these cover: a fire drawn at the arithmetic centre of its cell
 * appeared to burn in the middle of the Cedar Grove Reservoir, because that is
 * where the centroid of the Little Falls cell falls.
 */

import { describe, expect, it } from 'vitest';

import { GRID, cellId, cellCenter, formatCellId } from './grid.js';
import { isTraversable } from './land.js';
import { displayPoint, towerNameFor, towerPoint } from './towers.js';
import { haversineKm } from './greatCircle.js';

const LITTLE_FALLS_CELL = cellId({ lat: 40.8668, lng: -74.2049 });

describe('towerPoint', () => {
  it('puts the Little Falls fire on the town, not in the reservoir', () => {
    expect(towerNameFor(LITTLE_FALLS_CELL)).toBe('Little Falls');

    const pin = towerPoint(LITTLE_FALLS_CELL);
    expect(pin).not.toBeNull();
    // Little Falls, NJ is at roughly 40.87, -74.21.
    expect(haversineKm(pin!, { lat: 40.8681, lng: -74.2087 })).toBeLessThan(3);
  });

  it('never returns a point outside its own cell', () => {
    // The guard that keeps route marks in order near coasts and borders.
    for (let row = 0; row < GRID.rows; row += 3) {
      for (let col = 0; col < GRID.cols; col += 3) {
        const cell = formatCellId({ row, col });
        const pin = towerPoint(cell);
        if (pin !== null) expect(cellId(pin)).toBe(cell);
      }
    }
  });

  it('falls back to the cell centre where no tower stands', () => {
    // Open ocean carries no tower, and still has to be drawable.
    const ocean = cellId({ lat: 26.5, lng: -71.0 });
    expect(isTraversable(ocean)).toBe(false);
    expect(towerPoint(ocean)).toBeNull();
    expect(displayPoint(ocean)).toEqual(cellCenter(ocean));
  });

  it('moves a pin far enough to matter but not far enough to lie', () => {
    // A pin that wandered to the next town would make a route read wrong; one
    // that never moves leaves fires on water. Both failures are visible.
    let moved = 0;
    let maxKm = 0;
    for (let row = 0; row < GRID.rows; row += 2) {
      for (let col = 0; col < GRID.cols; col += 2) {
        const cell = formatCellId({ row, col });
        if (!isTraversable(cell)) continue;
        const pin = towerPoint(cell);
        if (pin === null) continue;
        const km = haversineKm(pin, cellCenter(cell));
        if (km > 0.5) moved++;
        maxKm = Math.max(maxKm, km);
      }
    }
    expect(moved).toBeGreaterThan(50);
    // Half a cell diagonal is the most a point inside the cell can be from its
    // centre — anything beyond that means the guard is not holding.
    expect(maxKm).toBeLessThan(40);
  });
});
