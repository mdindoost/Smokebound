/**
 * The launch grid (MECHANICS §1, ARCHITECTURE §5).
 *
 * Equirectangular ~50 km cells over the CONUS bounding box 24°N–49.5°N,
 * 125°W–66°W. Pure, deterministic, no I/O: this module is the foundation
 * everything else trusts.
 *
 * Grid geometry is the ONE thing read from compiled defaults rather than the
 * `mechanics_config` table, because cell ids are persisted identifiers
 * (`profiles.home_cell`, `messages.route`, `weather_cells.cell`). Re-gridding is
 * a data migration, not a beta tuning knob. `assertGridMatchesConfig()` makes
 * the engine refuse to start if the DB and this module ever disagree.
 *
 * Conventions:
 *  - Row 0 is the southernmost row; rows increase northward.
 *  - Column 0 is the westernmost column; columns increase eastward.
 *  - Ids are `r%03dc%03d`, e.g. `r000c000` at the south-west corner.
 *  - Cell *width* in degrees is constant, computed so a cell is 50 km wide at
 *    the bbox's centre latitude (57 km at 24°N, 40 km at 49.5°N). Cell height is
 *    a constant 50 km everywhere.
 *  - The grid is the smallest cell-aligned rectangle that *covers* the bbox, so
 *    the outermost row/column can extend slightly past it. Everything inside
 *    the grid extent is addressable; that keeps `cellId(cellCenter(id)) === id`
 *    true for every cell, including edge ones.
 */

import { MECHANICS_DEFAULTS } from '../mechanics/defaults.js';
import type { MechanicsConfig } from '../mechanics/config.js';
import { OutOfGridError } from './types.js';
import type { CellBounds, CellId, LatLng, RowCol } from './types.js';

/** Mean Earth radius (IUGG), km. Geodesy, not gameplay. */
export const EARTH_RADIUS_KM = 6371.0088;

/** Kilometres per degree of latitude on a sphere of `EARTH_RADIUS_KM`. */
export const KM_PER_DEG_LAT = (Math.PI / 180) * EARTH_RADIUS_KM;

const CELL_KM = MECHANICS_DEFAULTS['grid.cell_km'];
const BBOX = MECHANICS_DEFAULTS['grid.bbox'];

const toRad = (deg: number): number => (deg * Math.PI) / 180;
const toDeg = (rad: number): number => (rad * 180) / Math.PI;

/** Latitude at which a cell is exactly `cell_km` wide. */
const REF_LAT = (BBOX.min_lat + BBOX.max_lat) / 2;

const LAT_STEP_DEG = CELL_KM / KM_PER_DEG_LAT;
const LNG_STEP_DEG = CELL_KM / (KM_PER_DEG_LAT * Math.cos(toRad(REF_LAT)));

const ROWS = Math.ceil((BBOX.max_lat - BBOX.min_lat) / LAT_STEP_DEG);
const COLS = Math.ceil((BBOX.max_lng - BBOX.min_lng) / LNG_STEP_DEG);

/** Immutable description of the launch grid. */
export const GRID = {
  cellKm: CELL_KM,
  bbox: BBOX,
  /** Grid extent — covers `bbox`, may exceed it by up to one cell on N/E edges. */
  extent: {
    min_lat: BBOX.min_lat,
    max_lat: BBOX.min_lat + ROWS * LAT_STEP_DEG,
    min_lng: BBOX.min_lng,
    max_lng: BBOX.min_lng + COLS * LNG_STEP_DEG,
  },
  refLat: REF_LAT,
  latStepDeg: LAT_STEP_DEG,
  lngStepDeg: LNG_STEP_DEG,
  rows: ROWS,
  cols: COLS,
  cellCount: ROWS * COLS,
} as const;

const CELL_ID_RE = /^r(\d{3})c(\d{3})$/;

/** Tolerance, in cell-index units, for snapping a point sitting on a cell edge. */
const INDEX_EPS = 1e-9;

/** `{row, col}` → `r041c112`. Throws if the cell is outside the grid. */
export function formatCellId({ row, col }: RowCol): CellId {
  if (!Number.isInteger(row) || !Number.isInteger(col)) {
    throw new OutOfGridError(`cell indices must be integers, got row=${row} col=${col}`);
  }
  if (row < 0 || row >= ROWS || col < 0 || col >= COLS) {
    throw new OutOfGridError(
      `cell r${row}c${col} is outside the ${ROWS}×${COLS} launch grid`,
    );
  }
  return `r${String(row).padStart(3, '0')}c${String(col).padStart(3, '0')}`;
}

/** `r041c112` → `{row, col}`. Throws on malformed or out-of-grid ids. */
export function parseCellId(id: CellId): RowCol {
  const m = CELL_ID_RE.exec(id);
  if (!m) throw new OutOfGridError(`malformed cell id "${id}" (expected e.g. "r041c112")`);
  const row = Number(m[1]);
  const col = Number(m[2]);
  if (row >= ROWS || col >= COLS) {
    throw new OutOfGridError(`cell "${id}" is outside the ${ROWS}×${COLS} launch grid`);
  }
  return { row, col };
}

/** True if `id` is well-formed *and* inside the grid. Never throws. */
export function isValidCellId(id: unknown): id is CellId {
  if (typeof id !== 'string') return false;
  try {
    parseCellId(id);
    return true;
  } catch {
    return false;
  }
}

/** True if the coordinate lies inside the addressable grid extent. */
export function isInsideGrid({ lat, lng }: LatLng): boolean {
  const e = GRID.extent;
  return lat >= e.min_lat && lat <= e.max_lat && lng >= e.min_lng && lng <= e.max_lng;
}

/** True if the coordinate lies inside the launch bbox proper (MECHANICS §1). */
export function isInsideBBox({ lat, lng }: LatLng): boolean {
  return (
    lat >= BBOX.min_lat && lat <= BBOX.max_lat && lng >= BBOX.min_lng && lng <= BBOX.max_lng
  );
}

/** Nearest in-grid coordinate. Used for prefetch paths that bulge past the edge. */
export function clampToGrid({ lat, lng }: LatLng): LatLng {
  const e = GRID.extent;
  // Nudge inside so the clamped point lands in the last cell, not one past it.
  const epsLat = LAT_STEP_DEG * 1e-6;
  const epsLng = LNG_STEP_DEG * 1e-6;
  return {
    lat: Math.min(Math.max(lat, e.min_lat), e.max_lat - epsLat),
    lng: Math.min(Math.max(lng, e.min_lng), e.max_lng - epsLng),
  };
}

/** Coordinate → cell id. Throws `OutOfGridError` outside the grid. */
export function cellId(point: LatLng): CellId;
export function cellId(lat: number, lng: number): CellId;
export function cellId(a: LatLng | number, b?: number): CellId {
  const { lat, lng } = typeof a === 'number' ? { lat: a, lng: b as number } : a;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new OutOfGridError(`non-finite coordinate (${lat}, ${lng})`);
  }
  if (!isInsideGrid({ lat, lng })) {
    throw new OutOfGridError(
      `(${lat}, ${lng}) is outside the launch grid ` +
        `[${GRID.extent.min_lat}, ${GRID.extent.max_lat}] × ` +
        `[${GRID.extent.min_lng}, ${GRID.extent.max_lng}] (MECHANICS §1: CONUS only)`,
    );
  }
  // INDEX_EPS makes boundary membership deterministic in the face of floating
  // point: a point on a shared edge belongs to the northern/eastern cell, even
  // when the division lands a few ulps short of the integer.
  // The far edges belong to the last row/column rather than to a phantom one.
  const row = Math.min(ROWS - 1, Math.floor((lat - BBOX.min_lat) / LAT_STEP_DEG + INDEX_EPS));
  const col = Math.min(COLS - 1, Math.floor((lng - BBOX.min_lng) / LNG_STEP_DEG + INDEX_EPS));
  return formatCellId({ row, col });
}

/** Coordinate → cell id, or `null` outside the grid. */
export function cellIdOrNull(point: LatLng): CellId | null {
  return isInsideGrid(point) ? cellId(point) : null;
}

/** Centre point of a cell — the routing/weather sample point for that cell. */
export function cellCenter(id: CellId): LatLng {
  const { row, col } = parseCellId(id);
  return {
    lat: BBOX.min_lat + (row + 0.5) * LAT_STEP_DEG,
    lng: BBOX.min_lng + (col + 0.5) * LNG_STEP_DEG,
  };
}

/** Lat/lng rectangle covered by a cell. */
export function cellBounds(id: CellId): CellBounds {
  const { row, col } = parseCellId(id);
  return {
    south: BBOX.min_lat + row * LAT_STEP_DEG,
    north: BBOX.min_lat + (row + 1) * LAT_STEP_DEG,
    west: BBOX.min_lng + col * LNG_STEP_DEG,
    east: BBOX.min_lng + (col + 1) * LNG_STEP_DEG,
  };
}

/**
 * 8-connected neighbours, clipped at the grid border (ARCHITECTURE §5).
 * Interior cells return 8, edge cells 5, corner cells 3. Order is deterministic:
 * S, SE, E, NE, N, NW, W, SW.
 */
export function neighbors(id: CellId): CellId[] {
  const { row, col } = parseCellId(id);
  const offsets: RowCol[] = [
    { row: -1, col: 0 },
    { row: -1, col: 1 },
    { row: 0, col: 1 },
    { row: 1, col: 1 },
    { row: 1, col: 0 },
    { row: 1, col: -1 },
    { row: 0, col: -1 },
    { row: -1, col: -1 },
  ];
  const out: CellId[] = [];
  for (const o of offsets) {
    const r = row + o.row;
    const c = col + o.col;
    if (r < 0 || r >= ROWS || c < 0 || c >= COLS) continue;
    out.push(formatCellId({ row: r, col: c }));
  }
  return out;
}

/** True if the two distinct cells touch (edge or corner). */
export function areNeighbors(a: CellId, b: CellId): boolean {
  const pa = parseCellId(a);
  const pb = parseCellId(b);
  const dr = Math.abs(pa.row - pb.row);
  const dc = Math.abs(pa.col - pb.col);
  return dr <= 1 && dc <= 1 && dr + dc > 0;
}

/** Chebyshev distance in cells (number of 8-connected steps between two cells). */
export function cellSteps(a: CellId, b: CellId): number {
  const pa = parseCellId(a);
  const pb = parseCellId(b);
  return Math.max(Math.abs(pa.row - pb.row), Math.abs(pa.col - pb.col));
}

/**
 * Grow a cell set by `rings` layers of neighbours.
 * `rings` must be supplied by the caller from `mechanics_config`
 * (`grid.prefetch_padding_cells`) — this module never assumes a padding number.
 */
export function expandWithPadding(cells: Iterable<CellId>, rings: number): CellId[] {
  let frontier = new Set<CellId>(cells);
  const all = new Set<CellId>(frontier);
  for (let i = 0; i < rings; i++) {
    const next = new Set<CellId>();
    for (const cell of frontier) {
      for (const n of neighbors(cell)) {
        if (!all.has(n)) {
          all.add(n);
          next.add(n);
        }
      }
    }
    if (next.size === 0) break;
    frontier = next;
  }
  return [...all];
}

/** Every cell id in the grid, row-major from the south-west corner. */
export function allCells(): CellId[] {
  const out: CellId[] = [];
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) out.push(formatCellId({ row, col }));
  }
  return out;
}

/**
 * Fail fast if the DB's grid geometry no longer matches the compiled grid.
 * Cell ids are persisted, so a mismatch means the stored ids point at different
 * ground than the code believes — never something to paper over at runtime.
 */
export function assertGridMatchesConfig(config: MechanicsConfig): void {
  const cfgCellKm = config.get('grid.cell_km');
  const cfgBBox = config.get('grid.bbox');
  const mismatches: string[] = [];
  if (cfgCellKm !== GRID.cellKm) {
    mismatches.push(`grid.cell_km: config ${cfgCellKm} vs compiled ${GRID.cellKm}`);
  }
  for (const k of ['min_lat', 'max_lat', 'min_lng', 'max_lng'] as const) {
    if (cfgBBox[k] !== BBOX[k]) {
      mismatches.push(`grid.bbox.${k}: config ${cfgBBox[k]} vs compiled ${BBOX[k]}`);
    }
  }
  if (mismatches.length) {
    throw new Error(
      'Grid geometry in mechanics_config does not match the compiled grid. ' +
        'Cell ids are persisted identifiers — re-gridding requires a data migration, ' +
        `not a config edit.\n  - ${mismatches.join('\n  - ')}`,
    );
  }
}

export { toRad, toDeg };
