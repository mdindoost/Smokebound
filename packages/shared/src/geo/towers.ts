/**
 * The tower layer (SPEC §3 v1.1).
 *
 * The smoke already hops cell to cell; towers make that visible and historically
 * honest — line-of-sight station chains, Great Wall style. Each routable cell
 * has a beacon tower named after the nearest place, so a flight timeline can say
 * "passed the Allegheny tower at 3:12 AM".
 *
 * **Cosmetic only.** Nothing in the router, the crons or the cost model reads
 * this file. When relays ship in v1.1 the mechanics attach to the same cells, and
 * these names are already the vocabulary for them.
 */

import { TOWER_INDEX, TOWER_NAMES, TOWER_POINTS } from './generated/towerNames.js';
import { GRID, cellCenter, cellId, isInsideGrid, parseCellId } from './grid.js';
import type { CellId, LatLng } from './types.js';

const WIDTH = 3;
const NONE = '...';

if (TOWER_INDEX.length !== GRID.cellCount * WIDTH) {
  throw new Error(
    `tower name table covers ${TOWER_INDEX.length / WIDTH} cells, grid has ${GRID.cellCount} — ` +
      'run: npm run generate:tower-names --workspace packages/shared',
  );
}

/** The name of the tower standing in this cell, or null where none does. */
export function towerNameFor(cell: CellId): string | null {
  const { row, col } = parseCellId(cell);
  const at = (row * GRID.cols + col) * WIDTH;
  const code = TOWER_INDEX.slice(at, at + WIDTH);
  if (code === NONE) return null;
  return TOWER_NAMES[parseInt(code, 36)] ?? null;
}

/** "the Toledo tower" — how a timeline line refers to it. */
export function towerPhrase(cell: CellId): string | null {
  const name = towerNameFor(cell);
  return name === null ? null : `the ${name} tower`;
}

/**
 * The towers a route passes, in order, without repeating a name.
 *
 * Consecutive cells often share the nearest place; a timeline that said
 * "passed the Toledo tower" four times in a row would read like a stutter.
 */
export function towersAlong(route: readonly CellId[]): { cell: CellId; name: string }[] {
  const out: { cell: CellId; name: string }[] = [];
  for (const cell of route) {
    const name = towerNameFor(cell);
    if (name === null) continue;
    if (out[out.length - 1]?.name === name) continue;
    out.push({ cell, name });
  }
  return out;
}

/** The index into the generated tables for a cell, or null where no tower stands. */
function towerIndexFor(cell: CellId): number | null {
  const { row, col } = parseCellId(cell);
  const at = (row * GRID.cols + col) * WIDTH;
  const code = TOWER_INDEX.slice(at, at + WIDTH);
  if (code === NONE) return null;
  const index = parseInt(code, 36);
  return Number.isNaN(index) ? null : index;
}

/**
 * Where the tower actually stands, when that is a place inside this cell.
 *
 * A cell centre is arithmetic, not geography: the centroid of the cell covering
 * Little Falls, NJ falls in the Cedar Grove Reservoir, and a fire drawn there
 * looks like it is burning on open water.
 *
 * The nearest place to a centroid is not guaranteed to be *in* the cell — near a
 * coast or a border the closest town can sit one cell over. Returning that point
 * would let a route's marks drift out of order, so a pin that lands outside its
 * own cell is refused here and the caller falls back to the centre. Geography
 * when we have it, arithmetic when we do not.
 *
 * **Drawing only.** Distances, ETAs and routing all stay on cell centres; a
 * pin moved a kilometre for the sake of dry land must never move a number.
 */
export function towerPoint(cell: CellId): LatLng | null {
  const index = towerIndexFor(cell);
  if (index === null) return null;
  const point = TOWER_POINTS[index];
  if (point === undefined) return null;

  const candidate: LatLng = { lat: point[0], lng: point[1] };
  if (!isInsideGrid(candidate)) return null;
  return cellId(candidate) === cell ? candidate : null;
}

/**
 * Where to draw a fire, a tower or a route endpoint for this cell.
 *
 * The town if we know it stands here, the cell centre otherwise. Never null, so
 * callers cannot accidentally skip a mark.
 */
export function displayPoint(cell: CellId): LatLng {
  return towerPoint(cell) ?? cellCenter(cell);
}

export { TOWER_NAMES, TOWER_POINTS };
