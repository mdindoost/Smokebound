/**
 * The land mask: sea and border rules (MECHANICS §1.1, ARCHITECTURE §5).
 *
 * Fail-open weather (MECHANICS §2.1) treats anything unfetchable as clear. Our
 * weather source is US-only, so *everywhere* NWS cannot see would otherwise be
 * the cheapest terrain on the map: the Atlantic (REDTEAM F13) and, just as
 * badly, Canada and Mexico (REDTEAM F16). A* would sail Newark→Miami offshore
 * and thread Detroit→Buffalo through Ontario.
 *
 * Both holes are closed structurally rather than by weather:
 *
 *   traversable = (is_us OR 8-adjacent to a US-land cell) AND NOT foreign_land
 *
 * The one-cell skirt keeps coastal cities routable (Newark, Miami and Seattle
 * all sit on the coast). The foreign-land exclusion keeps smoke inside the
 * launch region. Neither is a weather condition, so nothing in the fail-open
 * path can override them.
 *
 * The border rule is a launch-region rule, not a permanent one: it exists
 * because our weather source stops at the border, and it reopens with
 * international expansion (SPEC §3 v2).
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

/** How a cell is classified by the mask. */
export type CellTerrain = 'us_land' | 'foreign_land' | 'water';

const US = 1;
const FOREIGN = 2;
const WATER = 0;

/** `terrain[row * cols + col]`. Rows are south-first, like the grid. */
const terrain = new Uint8Array(GRID.cellCount);
/** Land (either country), or touching US land: the cells smoke may occupy. */
const traversable = new Uint8Array(GRID.cellCount);

for (let row = 0; row < GRID.rows; row++) {
  // The generated file is north-first so it reads like a map; flip it back.
  const line = LAND_MASK_ROWS[GRID.rows - 1 - row]!;
  if (line.length !== GRID.cols) {
    throw new Error(`land mask row ${row} has ${line.length} columns, expected ${GRID.cols}`);
  }
  for (let col = 0; col < GRID.cols; col++) {
    const char = line[col];
    terrain[row * GRID.cols + col] = char === '#' ? US : char === '~' ? FOREIGN : WATER;
  }
}

for (let row = 0; row < GRID.rows; row++) {
  for (let col = 0; col < GRID.cols; col++) {
    const index = row * GRID.cols + col;
    if (terrain[index] === FOREIGN) continue; // never traversable in v1
    if (terrain[index] === US) {
      traversable[index] = 1;
      continue;
    }
    // Water: routable only within one cell of US land.
    for (const n of neighbors(formatCellId({ row, col }))) {
      const p = parseCellId(n);
      if (terrain[p.row * GRID.cols + p.col] === US) {
        traversable[index] = 1;
        break;
      }
    }
  }
}

function indexOf(id: CellId): number {
  const { row, col } = parseCellId(id);
  return row * GRID.cols + col;
}

export function terrainOf(id: CellId): CellTerrain {
  const value = terrain[indexOf(id)];
  return value === US ? 'us_land' : value === FOREIGN ? 'foreign_land' : 'water';
}

/** True if the cell is US land. */
export function isUsLand(id: CellId): boolean {
  return terrain[indexOf(id)] === US;
}

/** True if the cell is land on the far side of a border (Canada, Mexico). */
export function isForeignLand(id: CellId): boolean {
  return terrain[indexOf(id)] === FOREIGN;
}

/** True if the cell contains any land, whoever it belongs to. */
export function isLand(id: CellId): boolean {
  return terrain[indexOf(id)] !== WATER;
}

/**
 * True if smoke may occupy this cell: US land, or water within one cell of US
 * land. Open ocean and foreign land are permanently impassable.
 */
export function isTraversable(id: CellId): boolean {
  return traversable[indexOf(id)] === 1;
}

/** Coastal water: traversable, but not itself land. */
export function isCoastalWater(id: CellId): boolean {
  const index = indexOf(id);
  return traversable[index] === 1 && terrain[index] === WATER;
}

const count = (predicate: (value: number) => boolean): number => {
  let n = 0;
  for (const value of terrain) if (predicate(value)) n++;
  return n;
};

export const LAND_STATS = {
  usLandCells: count((v) => v === US),
  foreignLandCells: count((v) => v === FOREIGN),
  waterCells: count((v) => v === WATER),
  traversableCells: traversable.reduce((n, v) => n + v, 0),
  totalCells: GRID.cellCount,
} as const;

export { LAND_MASK_META };
