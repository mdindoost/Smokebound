/**
 * The ocean rule (MECHANICS §1.1, ARCHITECTURE §5).
 *
 * Fail-open weather (MECHANICS §2.1) treats anything unfetchable as clear. Over
 * water that would make the Atlantic the cheapest terrain on the map and A*
 * would happily sail a Newark→Miami message a hundred miles offshore. So water
 * is excluded structurally rather than by weather:
 *
 *   traversable = is_land OR 8-adjacent to a land cell
 *
 * The one-cell skirt keeps coastal cities routable (Newark, Miami and Seattle
 * all sit on the coast, and their great-circle corridors clip the shore) without
 * opening the open ocean. Open-ocean cells are impassable *always* — this is a
 * structural fact about the world, not a weather condition, so nothing in the
 * fail-open path can override it.
 */

import { LAND_MASK_META, LAND_MASK_ROWS } from './generated/landMask.js';
import { GRID, formatCellId, neighbors, parseCellId } from './grid.js';
import type { CellId } from './types.js';

const EXPECTED_SIGNATURE =
  `${GRID.rows}x${GRID.cols}@${GRID.cellKm}km/` +
  `${GRID.bbox.min_lat},${GRID.bbox.min_lng},${GRID.bbox.max_lat},${GRID.bbox.max_lng}`;

if (LAND_MASK_META.gridSignature !== EXPECTED_SIGNATURE) {
  throw new Error(
    'The committed land mask was generated against a different grid ' +
      `(mask: ${LAND_MASK_META.gridSignature}, code: ${EXPECTED_SIGNATURE}). ` +
      'Run: npm run generate:land-mask --workspace packages/shared',
  );
}

if (LAND_MASK_ROWS.length !== GRID.rows) {
  throw new Error(
    `land mask has ${LAND_MASK_ROWS.length} rows, grid has ${GRID.rows} — regenerate it`,
  );
}

/** `land[row * cols + col]` — 1 for land. Rows are south-first, like the grid. */
const land = new Uint8Array(GRID.cellCount);
/** Land, or touching land: the cells smoke may occupy. */
const traversable = new Uint8Array(GRID.cellCount);

for (let row = 0; row < GRID.rows; row++) {
  // The generated file is north-first so it reads like a map; flip it back.
  const line = LAND_MASK_ROWS[GRID.rows - 1 - row]!;
  if (line.length !== GRID.cols) {
    throw new Error(`land mask row ${row} has ${line.length} columns, expected ${GRID.cols}`);
  }
  for (let col = 0; col < GRID.cols; col++) {
    if (line[col] === '#') land[row * GRID.cols + col] = 1;
  }
}

for (let row = 0; row < GRID.rows; row++) {
  for (let col = 0; col < GRID.cols; col++) {
    const index = row * GRID.cols + col;
    if (land[index]) {
      traversable[index] = 1;
      continue;
    }
    for (const n of neighbors(formatCellId({ row, col }))) {
      const p = parseCellId(n);
      if (land[p.row * GRID.cols + p.col]) {
        traversable[index] = 1;
        break;
      }
    }
  }
}

const LAND_CELL_COUNT = land.reduce((n, v) => n + v, 0);
const TRAVERSABLE_CELL_COUNT = traversable.reduce((n, v) => n + v, 0);

function indexOf(id: CellId): number {
  const { row, col } = parseCellId(id);
  return row * GRID.cols + col;
}

/** True if the cell contains any land (Natural Earth 1:10m). */
export function isLand(id: CellId): boolean {
  return land[indexOf(id)] === 1;
}

/**
 * True if smoke may occupy this cell: land, or water within one cell of land.
 * Everything else is open ocean and permanently impassable.
 */
export function isTraversable(id: CellId): boolean {
  return traversable[indexOf(id)] === 1;
}

/** Coastal water: traversable, but not itself land. */
export function isCoastalWater(id: CellId): boolean {
  const index = indexOf(id);
  return traversable[index] === 1 && land[index] === 0;
}

export const LAND_STATS = {
  landCells: LAND_CELL_COUNT,
  traversableCells: TRAVERSABLE_CELL_COUNT,
  openOceanCells: GRID.cellCount - TRAVERSABLE_CELL_COUNT,
  totalCells: GRID.cellCount,
} as const;

export { LAND_MASK_META };
