import { describe, expect, it } from 'vitest';

import {
  GRID,
  KM_PER_DEG_LAT,
  allCells,
  areNeighbors,
  cellBounds,
  cellCenter,
  cellId,
  cellIdOrNull,
  cellSteps,
  clampToGrid,
  expandWithPadding,
  formatCellId,
  isInsideBBox,
  isInsideGrid,
  isValidCellId,
  neighbors,
  parseCellId,
} from './grid.js';
import { haversineKm } from './greatCircle.js';
import { OutOfGridError } from './types.js';

/** Deterministic LCG so failures are reproducible. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

const SW = { lat: GRID.bbox.min_lat, lng: GRID.bbox.min_lng };
const NE_BBOX = { lat: GRID.bbox.max_lat, lng: GRID.bbox.max_lng };
const LAST_CELL = formatCellId({ row: GRID.rows - 1, col: GRID.cols - 1 });

describe('grid geometry (MECHANICS §1)', () => {
  it('covers the CONUS launch bbox', () => {
    expect(GRID.extent.min_lat).toBe(GRID.bbox.min_lat);
    expect(GRID.extent.min_lng).toBe(GRID.bbox.min_lng);
    expect(GRID.extent.max_lat).toBeGreaterThanOrEqual(GRID.bbox.max_lat);
    expect(GRID.extent.max_lng).toBeGreaterThanOrEqual(GRID.bbox.max_lng);
    // ...and does not overshoot by more than one cell in either direction.
    expect(GRID.extent.max_lat - GRID.bbox.max_lat).toBeLessThan(GRID.latStepDeg);
    expect(GRID.extent.max_lng - GRID.bbox.max_lng).toBeLessThan(GRID.lngStepDeg);
  });

  it('has cells one cell_km tall everywhere', () => {
    for (const row of [0, Math.floor(GRID.rows / 2), GRID.rows - 1]) {
      const b = cellBounds(formatCellId({ row, col: 0 }));
      const heightKm = haversineKm({ lat: b.south, lng: b.west }, { lat: b.north, lng: b.west });
      expect(heightKm).toBeCloseTo(GRID.cellKm, 1);
    }
  });

  it('has cells one cell_km wide at the reference latitude', () => {
    const row = Math.round((GRID.refLat - GRID.bbox.min_lat) / GRID.latStepDeg);
    const b = cellBounds(formatCellId({ row, col: 10 }));
    const mid = (b.south + b.north) / 2;
    const widthKm = haversineKm({ lat: mid, lng: b.west }, { lat: mid, lng: b.east });
    expect(widthKm).toBeGreaterThan(GRID.cellKm * 0.98);
    expect(widthKm).toBeLessThan(GRID.cellKm * 1.02);
  });

  it('is large enough to hold the ~3,200 land cells the spec expects', () => {
    // The bbox includes ocean, Canada and Mexico, so total cells exceed land cells.
    expect(GRID.cellCount).toBe(GRID.rows * GRID.cols);
    expect(GRID.cellCount).toBeGreaterThan(3200);
    expect(GRID.cellCount).toBeLessThan(12000);
  });

  it('derives latitude spacing from the earth radius, not a magic constant', () => {
    expect(GRID.latStepDeg).toBeCloseTo(GRID.cellKm / KM_PER_DEG_LAT, 12);
  });
});

describe('cell id encoding', () => {
  it('round-trips row/col through the id format', () => {
    for (const rc of [
      { row: 0, col: 0 },
      { row: 1, col: 9 },
      { row: 41, col: 12 },
      { row: GRID.rows - 1, col: GRID.cols - 1 },
    ]) {
      expect(parseCellId(formatCellId(rc))).toEqual(rc);
    }
  });

  it('uses the r000c000 shape from ARCHITECTURE §3', () => {
    expect(formatCellId({ row: 0, col: 0 })).toBe('r000c000');
    expect(formatCellId({ row: 41, col: 12 })).toBe('r041c012');
  });

  it('rejects malformed ids', () => {
    for (const bad of ['', 'r41c12', 'x041c012', 'r041', 'r041c012 ', 'R041C012', 'r-01c012']) {
      expect(() => parseCellId(bad)).toThrow(OutOfGridError);
      expect(isValidCellId(bad)).toBe(false);
    }
  });

  it('rejects ids outside the grid', () => {
    expect(() => parseCellId(formatCellId({ row: GRID.rows - 1, col: 0 }))).not.toThrow();
    expect(() => parseCellId(`r${String(GRID.rows).padStart(3, '0')}c000`)).toThrow(OutOfGridError);
    expect(() => parseCellId(`r000c${String(GRID.cols).padStart(3, '0')}`)).toThrow(OutOfGridError);
    expect(() => formatCellId({ row: -1, col: 0 })).toThrow(OutOfGridError);
    expect(() => formatCellId({ row: 0.5, col: 0 })).toThrow(OutOfGridError);
    expect(isValidCellId('r999c999')).toBe(false);
    expect(isValidCellId(42)).toBe(false);
  });
});

describe('cellId ↔ cellCenter round trips (ARCHITECTURE §5)', () => {
  it('every cell centre maps back to its own cell', () => {
    const cells = allCells();
    expect(cells).toHaveLength(GRID.cellCount);
    expect(new Set(cells).size).toBe(GRID.cellCount);
    for (const id of cells) {
      expect(cellId(cellCenter(id))).toBe(id);
    }
  });

  it('random in-grid points land in a cell whose bounds contain them', () => {
    const rand = lcg(20260814);
    for (let i = 0; i < 5000; i++) {
      const lat =
        GRID.extent.min_lat + rand() * (GRID.extent.max_lat - GRID.extent.min_lat) * 0.999999;
      const lng =
        GRID.extent.min_lng + rand() * (GRID.extent.max_lng - GRID.extent.min_lng) * 0.999999;
      const id = cellId({ lat, lng });
      const b = cellBounds(id);
      expect(lat).toBeGreaterThanOrEqual(b.south);
      expect(lat).toBeLessThanOrEqual(b.north);
      expect(lng).toBeGreaterThanOrEqual(b.west);
      expect(lng).toBeLessThanOrEqual(b.east);
      // The centre of that cell is never further than half a cell diagonal away.
      const c = cellCenter(id);
      expect(haversineKm(c, { lat, lng })).toBeLessThan(GRID.cellKm);
      expect(cellId(c)).toBe(id);
    }
  });

  it('accepts both call signatures', () => {
    expect(cellId(40.7357, -74.1724)).toBe(cellId({ lat: 40.7357, lng: -74.1724 }));
  });
});

describe('bbox edge cells', () => {
  it('anchors the south-west bbox corner at r000c000', () => {
    expect(cellId(SW)).toBe('r000c000');
    expect(isInsideBBox(SW)).toBe(true);
    expect(isInsideGrid(SW)).toBe(true);
  });

  it('puts the north-east bbox corner in the last row and column', () => {
    expect(cellId(NE_BBOX)).toBe(LAST_CELL);
  });

  it('keeps the extreme grid corner inside the last cell rather than one past it', () => {
    expect(cellId({ lat: GRID.extent.max_lat, lng: GRID.extent.max_lng })).toBe(LAST_CELL);
    expect(cellId({ lat: GRID.extent.max_lat, lng: GRID.extent.min_lng })).toBe(
      formatCellId({ row: GRID.rows - 1, col: 0 }),
    );
  });

  it('places points on an internal boundary in the northern/eastern cell', () => {
    const boundaryLat = GRID.bbox.min_lat + GRID.latStepDeg;
    const boundaryLng = GRID.bbox.min_lng + GRID.lngStepDeg;
    expect(cellId({ lat: boundaryLat, lng: GRID.bbox.min_lng })).toBe(
      formatCellId({ row: 1, col: 0 }),
    );
    expect(cellId({ lat: GRID.bbox.min_lat, lng: boundaryLng })).toBe(
      formatCellId({ row: 0, col: 1 }),
    );
  });

  it('rejects coordinates outside the grid (no AK/HI/international in v1)', () => {
    const outside = [
      { lat: GRID.extent.min_lat - 0.01, lng: -100 }, // south of the bbox (Mexico/Gulf)
      { lat: GRID.extent.max_lat + 0.01, lng: -100 }, // north of the bbox (Canada)
      { lat: 40, lng: GRID.extent.min_lng - 0.01 }, // west (Pacific)
      { lat: 40, lng: GRID.extent.max_lng + 0.01 }, // east (Atlantic)
      { lat: 61.2181, lng: -149.9003 }, // Anchorage, AK
      { lat: 21.3069, lng: -157.8583 }, // Honolulu, HI
      { lat: 51.5074, lng: -0.1278 }, // London
    ];
    for (const p of outside) {
      expect(() => cellId(p)).toThrow(OutOfGridError);
      expect(cellIdOrNull(p)).toBeNull();
      expect(isInsideGrid(p)).toBe(false);
    }
  });

  it('rejects non-finite coordinates', () => {
    expect(() => cellId({ lat: Number.NaN, lng: -100 })).toThrow(OutOfGridError);
    expect(() => cellId({ lat: 40, lng: Number.POSITIVE_INFINITY })).toThrow(OutOfGridError);
  });

  it('clamps out-of-grid points onto the border cell', () => {
    const clamped = clampToGrid({ lat: 60, lng: -40 });
    expect(isInsideGrid(clamped)).toBe(true);
    expect(cellId(clamped)).toBe(LAST_CELL);
    const sw = clampToGrid({ lat: 0, lng: -180 });
    expect(cellId(sw)).toBe('r000c000');
    // Already-inside points are returned untouched.
    expect(clampToGrid({ lat: 40, lng: -100 })).toEqual({ lat: 40, lng: -100 });
  });

  it('distinguishes the bbox from the covering grid extent', () => {
    const justPastBBox = { lat: GRID.bbox.max_lat + GRID.latStepDeg / 4, lng: -100 };
    expect(isInsideBBox(justPastBBox)).toBe(false);
    expect(isInsideGrid(justPastBBox)).toBe(true);
  });
});

describe('neighbors (8-connected, clipped at the border)', () => {
  const interior = formatCellId({ row: 20, col: 40 });

  it('returns 8 neighbours for an interior cell, in a stable order', () => {
    const n = neighbors(interior);
    expect(n).toHaveLength(8);
    expect(new Set(n).size).toBe(8);
    expect(n).not.toContain(interior);
    expect(n).toEqual([
      formatCellId({ row: 19, col: 40 }),
      formatCellId({ row: 19, col: 41 }),
      formatCellId({ row: 20, col: 41 }),
      formatCellId({ row: 21, col: 41 }),
      formatCellId({ row: 21, col: 40 }),
      formatCellId({ row: 21, col: 39 }),
      formatCellId({ row: 20, col: 39 }),
      formatCellId({ row: 19, col: 39 }),
    ]);
  });

  it('returns 3 neighbours at each grid corner', () => {
    const corners = [
      { row: 0, col: 0 },
      { row: 0, col: GRID.cols - 1 },
      { row: GRID.rows - 1, col: 0 },
      { row: GRID.rows - 1, col: GRID.cols - 1 },
    ];
    for (const rc of corners) {
      expect(neighbors(formatCellId(rc))).toHaveLength(3);
    }
  });

  it('returns 5 neighbours along each non-corner border', () => {
    const edges = [
      { row: 0, col: 10 }, // south
      { row: GRID.rows - 1, col: 10 }, // north
      { row: 10, col: 0 }, // west
      { row: 10, col: GRID.cols - 1 }, // east
    ];
    for (const rc of edges) {
      expect(neighbors(formatCellId(rc))).toHaveLength(5);
    }
  });

  it('never leaves the grid and is reciprocal for every cell', () => {
    for (const id of allCells()) {
      const ns = neighbors(id);
      expect(new Set(ns).size).toBe(ns.length);
      for (const n of ns) {
        expect(isValidCellId(n)).toBe(true);
        expect(areNeighbors(id, n)).toBe(true);
        expect(neighbors(n)).toContain(id);
      }
    }
  });

  it('gives every cell 3, 5 or 8 neighbours and 8 for all interior cells', () => {
    let interiorCount = 0;
    for (const id of allCells()) {
      const { row, col } = parseCellId(id);
      const count = neighbors(id).length;
      const isInterior = row > 0 && row < GRID.rows - 1 && col > 0 && col < GRID.cols - 1;
      if (isInterior) {
        expect(count).toBe(8);
        interiorCount++;
      } else {
        expect([3, 5]).toContain(count);
      }
    }
    expect(interiorCount).toBe((GRID.rows - 2) * (GRID.cols - 2));
  });

  it('measures step distance in Chebyshev cells', () => {
    expect(cellSteps('r000c000', 'r000c000')).toBe(0);
    expect(cellSteps('r000c000', 'r001c001')).toBe(1);
    expect(cellSteps('r000c000', 'r003c010')).toBe(10);
    expect(areNeighbors('r000c000', 'r000c000')).toBe(false);
    expect(areNeighbors('r000c000', 'r001c001')).toBe(true);
    expect(areNeighbors('r000c000', 'r002c000')).toBe(false);
  });
});

describe('expandWithPadding (lazy weather prefetch)', () => {
  const interior = formatCellId({ row: 20, col: 40 });

  it('is the identity with zero rings', () => {
    expect(expandWithPadding([interior], 0)).toEqual([interior]);
  });

  it('adds one full ring around an interior cell', () => {
    const padded = expandWithPadding([interior], 1);
    expect(padded).toHaveLength(9);
    expect(new Set(padded).size).toBe(9);
    expect(padded).toContain(interior);
  });

  it('clips the ring at the grid corner', () => {
    expect(expandWithPadding(['r000c000'], 1)).toHaveLength(4);
  });

  it('adds two rings without duplicating cells', () => {
    const padded = expandWithPadding([interior], 2);
    expect(padded).toHaveLength(25);
    expect(new Set(padded).size).toBe(25);
  });

  it('pads a path as a set, not per cell', () => {
    const path = [formatCellId({ row: 20, col: 40 }), formatCellId({ row: 20, col: 41 })];
    const padded = expandWithPadding(path, 1);
    expect(padded).toHaveLength(12); // 3×4 block
    expect(new Set(padded).size).toBe(12);
  });
});
