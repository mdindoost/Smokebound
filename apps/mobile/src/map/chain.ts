/**
 * Which tower is burning (M5.7) — the arithmetic, with no platform in it.
 *
 * Split from `NightChain.tsx` for the same reason `design/motion.ts` was split
 * from `BreathingEmber.tsx`: a module that imports react-native cannot be loaded
 * by the test bundler at all, so logic living beside a component is logic that
 * cannot be tested. The rule this codebase keeps arriving at is that the
 * interesting part should never need a screen to exercise.
 *
 * Device evidence at 3:29 AM: the night layer worked — fire-styled marker, night
 * copy — and the fire still *drifted across the map as a dot*. Which is wrong in
 * a way no restyling fixes. **Fire does not travel.** Light does not move along
 * a route; towers kindle in sequence, and a signal's position after dark is
 * *which tower is currently burning*.
 *
 * **Every link is server truth.** The blazing tower is the cell the engine has
 * confirmed (`current_leg`), never the interpolated position — DESIGN.md V7. By
 * day, interpolation may run ahead cosmetically, because a dot between waypoints
 * is obviously an approximation. A *lit tower* is not: it is a claim that the
 * fire reached that station, and the client has no business making it.
 */

import { towerNameFor } from '@smoke/shared';
import type { CellId } from '@smoke/shared';

export type ChainPhase = 'passed' | 'current' | 'ahead';

export interface ChainLink {
  cell: CellId;
  name: string;
  phase: ChainPhase;
}

/**
 * The chain for a route, given the last cell the *engine* has confirmed.
 *
 * Cells with no tower are skipped rather than drawn blank: no tower stands
 * there, and an empty mark would imply one does.
 *
 * **R22 interaction.** By day the map thins towers so the ember stays the hero.
 * At night the towers are not labels — they are the signal — so the whole route
 * chain renders, name-change de-stuttering and all. Zoom still governs their
 * *size*, because a tower seen from orbit is a dot and one seen closely is a
 * landmark.
 */
export function chainFor(route: readonly CellId[], confirmed: readonly CellId[]): ChainLink[] {
  const confirmedSet = new Set(confirmed);
  // The blazing link is the last confirmed cell that carries a tower.
  let current: CellId | null = null;
  for (const cell of route) {
    if (confirmedSet.has(cell) && towerNameFor(cell) !== null) current = cell;
  }

  const links: ChainLink[] = [];
  let seenCurrent = false;
  for (const cell of route) {
    const name = towerNameFor(cell);
    if (name === null) continue;

    let phase: ChainPhase;
    if (cell === current) {
      phase = 'current';
      seenCurrent = true;
    } else if (!seenCurrent && confirmedSet.has(cell)) {
      phase = 'passed';
    } else {
      phase = 'ahead';
    }
    links.push({ cell, name, phase });
  }
  return links;
}
