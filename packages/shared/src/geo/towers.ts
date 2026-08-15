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

import { TOWER_INDEX, TOWER_NAMES } from './generated/towerNames.js';
import { GRID, parseCellId } from './grid.js';
import type { CellId } from './types.js';

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

export { TOWER_NAMES };
