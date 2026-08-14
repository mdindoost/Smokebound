import { describe, expect, it } from 'vitest';

import {
  GRID,
  areNeighbors,
  cellCenter,
  cellId,
  cellSteps,
  isValidCellId,
  formatCellId,
} from './grid.js';
import {
  cellsAlongGreatCircle,
  greatCirclePoints,
  haversineKm,
  initialBearingDeg,
  interpolateGreatCircle,
} from './greatCircle.js';
import { OutOfGridError } from './types.js';

/** Endpoints used by the MECHANICS §7 worked examples. */
const NEWARK = { lat: 40.7357, lng: -74.1724 };
const CHICAGO = { lat: 41.8781, lng: -87.6298 };
const PHILADELPHIA = { lat: 39.9526, lng: -75.1652 };
const MIAMI = { lat: 25.7617, lng: -80.1918 };
const ATLANTIC = { lat: 40, lng: -60 }; // outside the launch grid (east of the bbox)

describe('haversineKm', () => {
  it('matches the distances quoted in MECHANICS §7', () => {
    // §7A: Newark → Chicago ≈ 1,150 km
    expect(haversineKm(NEWARK, CHICAGO)).toBeGreaterThan(1100);
    expect(haversineKm(NEWARK, CHICAGO)).toBeLessThan(1200);
    // §7B: Newark → Philadelphia ≈ 130 km
    expect(haversineKm(NEWARK, PHILADELPHIA)).toBeGreaterThan(115);
    expect(haversineKm(NEWARK, PHILADELPHIA)).toBeLessThan(145);
    // §7C: Newark → Miami ≈ 1,750 km
    expect(haversineKm(NEWARK, MIAMI)).toBeGreaterThan(1650);
    expect(haversineKm(NEWARK, MIAMI)).toBeLessThan(1850);
  });

  it('is symmetric and zero for identical points', () => {
    expect(haversineKm(NEWARK, CHICAGO)).toBeCloseTo(haversineKm(CHICAGO, NEWARK), 9);
    expect(haversineKm(NEWARK, NEWARK)).toBe(0);
  });

  it('agrees with the degree-of-latitude constant along a meridian', () => {
    const km = haversineKm({ lat: 40, lng: -100 }, { lat: 41, lng: -100 });
    expect(km).toBeCloseTo(GRID.cellKm / GRID.latStepDeg, 6);
  });
});

describe('interpolateGreatCircle', () => {
  it('returns the endpoints at f = 0 and f = 1', () => {
    expect(interpolateGreatCircle(NEWARK, CHICAGO, 0).lat).toBeCloseTo(NEWARK.lat, 9);
    expect(interpolateGreatCircle(NEWARK, CHICAGO, 0).lng).toBeCloseTo(NEWARK.lng, 9);
    expect(interpolateGreatCircle(NEWARK, CHICAGO, 1).lat).toBeCloseTo(CHICAGO.lat, 9);
    expect(interpolateGreatCircle(NEWARK, CHICAGO, 1).lng).toBeCloseTo(CHICAGO.lng, 9);
  });

  it('splits the distance evenly at the midpoint', () => {
    const mid = interpolateGreatCircle(NEWARK, CHICAGO, 0.5);
    const total = haversineKm(NEWARK, CHICAGO);
    expect(haversineKm(NEWARK, mid)).toBeCloseTo(total / 2, 6);
    expect(haversineKm(mid, CHICAGO)).toBeCloseTo(total / 2, 6);
  });

  it('bulges poleward of the rhumb line between two same-latitude points', () => {
    const mid = interpolateGreatCircle({ lat: 45, lng: -110 }, { lat: 45, lng: -80 }, 0.5);
    expect(mid.lat).toBeGreaterThan(45);
  });

  it('handles degenerate zero-length paths', () => {
    expect(interpolateGreatCircle(NEWARK, NEWARK, 0.5)).toEqual(NEWARK);
  });

  it('produces n + 1 inclusive sample points', () => {
    const pts = greatCirclePoints(NEWARK, CHICAGO, 10);
    expect(pts).toHaveLength(11);
    expect(() => greatCirclePoints(NEWARK, CHICAGO, 0)).toThrow(RangeError);
  });

  it('reports a westward bearing from Newark to Chicago', () => {
    const bearing = initialBearingDeg(NEWARK, CHICAGO);
    expect(bearing).toBeGreaterThan(270);
    expect(bearing).toBeLessThan(305);
  });
});

describe('cellsAlongGreatCircle — Newark → Chicago (MECHANICS §7A)', () => {
  const path = cellsAlongGreatCircle(NEWARK, CHICAGO);

  it('starts and ends at the endpoint cells', () => {
    expect(path[0]).toBe(cellId(NEWARK));
    expect(path[path.length - 1]).toBe(cellId(CHICAGO));
  });

  it('covers roughly the ~23 cells the spec expects', () => {
    const steps = cellSteps(cellId(NEWARK), cellId(CHICAGO));
    expect(path.length).toBeGreaterThanOrEqual(steps + 1);
    expect(path.length).toBeLessThanOrEqual(steps + 5);
    expect(path.length).toBeGreaterThan(18);
    expect(path.length).toBeLessThan(32);
  });

  it('is contiguous: every consecutive pair is 8-connected', () => {
    for (let i = 1; i < path.length; i++) {
      expect(areNeighbors(path[i - 1]!, path[i]!)).toBe(true);
    }
  });

  it('visits every cell the path actually crosses (no gaps)', () => {
    const covered = new Set(path);
    for (let f = 0; f <= 1; f += 0.001) {
      expect(covered.has(cellId(interpolateGreatCircle(NEWARK, CHICAGO, f)))).toBe(true);
    }
  });

  it('does not revisit a cell', () => {
    expect(new Set(path).size).toBe(path.length);
  });

  it('stays within a cell of the direct line', () => {
    for (const id of path) {
      const c = cellCenter(id);
      // Distance from the centre to the closest point sampled on the path.
      let closest = Number.POSITIVE_INFINITY;
      for (let f = 0; f <= 1; f += 0.002) {
        closest = Math.min(closest, haversineKm(c, interpolateGreatCircle(NEWARK, CHICAGO, f)));
      }
      expect(closest).toBeLessThan(GRID.cellKm);
    }
  });

  it('crosses Pennsylvania and Ohio — the storm-wall corridor of the worked example', () => {
    const lngs = path.map((id) => cellCenter(id).lng);
    expect(Math.min(...lngs)).toBeLessThan(-87); // reaches Illinois
    expect(Math.max(...lngs)).toBeGreaterThan(-75); // starts in NJ
    // Some cell centre sits inside the PA/OH corridor.
    expect(path.some((id) => cellCenter(id).lng < -78 && cellCenter(id).lng > -84)).toBe(true);
  });

  it('is symmetric as a set when reversed', () => {
    const back = cellsAlongGreatCircle(CHICAGO, NEWARK);
    expect(new Set(back)).toEqual(new Set(path));
    expect(back[0]).toBe(cellId(CHICAGO));
  });

  it('accepts cell ids as endpoints', () => {
    const fromIds = cellsAlongGreatCircle(cellId(NEWARK), cellId(CHICAGO));
    expect(fromIds[0]).toBe(cellId(NEWARK));
    expect(fromIds[fromIds.length - 1]).toBe(cellId(CHICAGO));
  });
});

describe('cellsAlongGreatCircle — degenerate and short paths', () => {
  it('returns a single cell for a same-cell send (MECHANICS §7.1)', () => {
    expect(cellsAlongGreatCircle(NEWARK, NEWARK)).toEqual([cellId(NEWARK)]);
    const nearby = cellCenter(cellId(NEWARK));
    expect(cellsAlongGreatCircle(NEWARK, nearby)).toEqual([cellId(NEWARK)]);
  });

  it('returns exactly two cells for an adjacent-cell send', () => {
    const a = formatCellId({ row: 20, col: 40 });
    const b = formatCellId({ row: 20, col: 41 });
    expect(cellsAlongGreatCircle(a, b)).toEqual([a, b]);
  });

  it('covers the ~3 cells of Newark → Philadelphia (MECHANICS §7B)', () => {
    const path = cellsAlongGreatCircle(NEWARK, PHILADELPHIA);
    expect(path.length).toBeGreaterThanOrEqual(2);
    expect(path.length).toBeLessThanOrEqual(5);
    expect(path[0]).toBe(cellId(NEWARK));
    expect(path[path.length - 1]).toBe(cellId(PHILADELPHIA));
  });

  it('keeps a long north-south path contiguous (Newark → Miami)', () => {
    const path = cellsAlongGreatCircle(NEWARK, MIAMI);
    for (let i = 1; i < path.length; i++) {
      expect(areNeighbors(path[i - 1]!, path[i]!)).toBe(true);
    }
    expect(path.length).toBeGreaterThan(25);
  });

  it('is resolution-independent: bisection refinement finds the same cells at any sampling rate', () => {
    const reference = cellsAlongGreatCircle(NEWARK, CHICAGO, { samplesPerCell: 32 });
    for (const samplesPerCell of [1, 2, 4, 8, 16]) {
      const path = cellsAlongGreatCircle(NEWARK, CHICAGO, { samplesPerCell });
      expect(path).toEqual(reference);
    }
    expect(() => cellsAlongGreatCircle(NEWARK, CHICAGO, { samplesPerCell: 0 })).toThrow(RangeError);
  });
});

describe('cellsAlongGreatCircle — paths that leave the launch grid', () => {
  it('clamps to the border by default and stays contiguous', () => {
    const path = cellsAlongGreatCircle(NEWARK, ATLANTIC);
    expect(path.every(isValidCellId)).toBe(true);
    for (let i = 1; i < path.length; i++) {
      expect(areNeighbors(path[i - 1]!, path[i]!)).toBe(true);
    }
    expect(path[0]).toBe(cellId(NEWARK));
    // Ends against the eastern edge of the grid.
    expect(cellCenter(path[path.length - 1]!).lng).toBeGreaterThan(GRID.bbox.max_lng - 1);
  });

  it('skips out-of-grid samples when asked', () => {
    const path = cellsAlongGreatCircle(NEWARK, ATLANTIC, { outside: 'skip' });
    expect(path.every(isValidCellId)).toBe(true);
    expect(path).not.toHaveLength(0);
  });

  it('throws when asked to be strict', () => {
    expect(() => cellsAlongGreatCircle(NEWARK, ATLANTIC, { outside: 'throw' })).toThrow(
      OutOfGridError,
    );
  });

  it('rejects an invalid cell id endpoint', () => {
    expect(() => cellsAlongGreatCircle('r999c999', cellId(NEWARK))).toThrow(OutOfGridError);
  });
});
