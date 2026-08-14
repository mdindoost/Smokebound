/**
 * Great-circle geometry and the cell sweep used for lazy weather prefetch
 * (MECHANICS §1, ARCHITECTURE §5). Pure and deterministic.
 */

import {
  EARTH_RADIUS_KM,
  GRID,
  cellCenter,
  cellId,
  clampToGrid,
  formatCellId,
  isInsideGrid,
  isValidCellId,
  parseCellId,
  toDeg,
  toRad,
} from './grid.js';
import { OutOfGridError } from './types.js';
import type { CellId, LatLng } from './types.js';

/** Great-circle distance in km (haversine). */
export function haversineKm(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial bearing from `a` to `b`, degrees clockwise from true north. */
export function initialBearingDeg(a: LatLng, b: LatLng): number {
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const dLng = toRad(b.lng - a.lng);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/**
 * Point at fraction `f` (0..1) along the great circle from `a` to `b`
 * (spherical linear interpolation).
 */
export function interpolateGreatCircle(a: LatLng, b: LatLng, f: number): LatLng {
  const lat1 = toRad(a.lat);
  const lng1 = toRad(a.lng);
  const lat2 = toRad(b.lat);
  const lng2 = toRad(b.lng);
  const d = haversineKm(a, b) / EARTH_RADIUS_KM;
  if (d === 0) return { lat: a.lat, lng: a.lng };

  const sinD = Math.sin(d);
  const A = Math.sin((1 - f) * d) / sinD;
  const B = Math.sin(f * d) / sinD;
  const x = A * Math.cos(lat1) * Math.cos(lng1) + B * Math.cos(lat2) * Math.cos(lng2);
  const y = A * Math.cos(lat1) * Math.sin(lng1) + B * Math.cos(lat2) * Math.sin(lng2);
  const z = A * Math.sin(lat1) + B * Math.sin(lat2);
  return {
    lat: toDeg(Math.atan2(z, Math.hypot(x, y))),
    lng: toDeg(Math.atan2(y, x)),
  };
}

/** `n + 1` evenly spaced points along the great circle, inclusive of both ends. */
export function greatCirclePoints(a: LatLng, b: LatLng, n: number): LatLng[] {
  if (n < 1) throw new RangeError('greatCirclePoints: n must be >= 1');
  const out: LatLng[] = [];
  for (let i = 0; i <= n; i++) out.push(interpolateGreatCircle(a, b, i / n));
  return out;
}

export type OutsideGridPolicy = 'clamp' | 'skip' | 'throw';

export interface CellsAlongOptions {
  /**
   * What to do with sampled points that fall outside the grid (a long
   * north-westward great circle can bulge past the CONUS bbox).
   * `clamp` (default) keeps the path contiguous by snapping to the border cell.
   */
  readonly outside?: OutsideGridPolicy;
  /** Samples taken per cell width. Higher = finer sweep. Structural, not gameplay. */
  readonly samplesPerCell?: number;
}

const DEFAULT_SAMPLES_PER_CELL = 8;

/**
 * Below this segment length (km) a transition is treated as a true corner
 * crossing and no further refinement is attempted.
 */
const REFINE_FLOOR_KM = 1e-4;

function toPoint(x: LatLng | CellId): LatLng {
  if (typeof x === 'string') {
    if (!isValidCellId(x)) throw new OutOfGridError(`invalid cell id "${x}"`);
    return cellCenter(x);
  }
  return x;
}

/** True if the two cells share an edge (not merely a corner). */
function isOrthogonalStep(a: CellId, b: CellId): boolean {
  const pa = parseCellId(a);
  const pb = parseCellId(b);
  return Math.abs(pa.row - pb.row) + Math.abs(pa.col - pb.col) === 1;
}

/** Cells strictly between two 8-connected-or-farther cells, in order. */
function bridge(from: CellId, to: CellId): CellId[] {
  const a = parseCellId(from);
  const b = parseCellId(to);
  const dRow = b.row - a.row;
  const dCol = b.col - a.col;
  const steps = Math.max(Math.abs(dRow), Math.abs(dCol));
  const out: CellId[] = [];
  for (let i = 1; i < steps; i++) {
    const row = a.row + Math.round((dRow * i) / steps);
    const col = a.col + Math.round((dCol * i) / steps);
    out.push(formatCellId({ row, col }));
  }
  return out;
}

/**
 * Ordered, contiguous list of cells a great-circle path passes through.
 * Endpoints may be given as coordinates or cell ids; the first and last entries
 * are always the endpoint cells.
 *
 * Contiguity guarantee: every consecutive pair is 8-connected, so the result can
 * be fed straight to the weather prefetcher (MECHANICS §1: route bbox cells,
 * padded via `expandWithPadding`).
 */
export function cellsAlongGreatCircle(
  a: LatLng | CellId,
  b: LatLng | CellId,
  options: CellsAlongOptions = {},
): CellId[] {
  const outside = options.outside ?? 'clamp';
  const samplesPerCell = options.samplesPerCell ?? DEFAULT_SAMPLES_PER_CELL;
  if (samplesPerCell < 1) throw new RangeError('samplesPerCell must be >= 1');

  const from = toPoint(a);
  const to = toPoint(b);

  const distanceKm = haversineKm(from, to);
  const steps = Math.max(1, Math.ceil((distanceKm / GRID.cellKm) * samplesPerCell));

  /** Cell at fraction `f`, or null when the sample is outside and skipped. */
  const cellAt = (f: number): CellId | null => {
    const raw = interpolateGreatCircle(from, to, f);
    if (isInsideGrid(raw)) return cellId(raw);
    if (outside === 'clamp') return cellId(clampToGrid(raw));
    if (outside === 'skip') return null;
    throw new OutOfGridError(
      `great-circle path leaves the launch grid at (${raw.lat.toFixed(4)}, ${raw.lng.toFixed(4)})`,
    );
  };

  const out: CellId[] = [];
  const push = (id: CellId): void => {
    if (out[out.length - 1] !== id) out.push(id);
  };

  /**
   * Append every cell the path enters between `f1` (in `c1`) and `f2` (in `c2`).
   * A diagonal or longer jump means the sampling was too coarse there, so the
   * interval is bisected until the real intermediate cell shows up — or until
   * the interval is so short the path genuinely crosses a cell corner.
   */
  const connect = (f1: number, c1: CellId, f2: number, c2: CellId): void => {
    if (c1 === c2) return;
    if (isOrthogonalStep(c1, c2)) {
      push(c2);
      return;
    }
    if ((f2 - f1) * distanceKm < REFINE_FLOOR_KM) {
      // A true corner crossing (or a degenerate zero-length path): keep the
      // sequence 8-connected and move on.
      for (const mid of bridge(c1, c2)) push(mid);
      push(c2);
      return;
    }
    const fm = (f1 + f2) / 2;
    const cm = cellAt(fm);
    if (cm === null) {
      push(c2);
      return;
    }
    connect(f1, c1, fm, cm);
    connect(fm, cm, f2, c2);
  };

  let prev: { f: number; cell: CellId } | null = null;
  for (let i = 0; i <= steps; i++) {
    const f = i / steps;
    const cell = cellAt(f);
    if (cell === null) continue; // outside === 'skip'
    if (prev === null) push(cell);
    else connect(prev.f, prev.cell, f, cell);
    prev = { f, cell };
  }
  return out;
}
