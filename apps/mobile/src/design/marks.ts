/**
 * Mark geometry (DESIGN.md V10 — visual constants live in the design layer).
 *
 * The night chain (M5.7) draws three states of the same object, and the states
 * have to be tellable apart at a glance from across a continent. Sizes are in
 * points and scale with zoom, because a tower you are looking at closely is a
 * landmark and one seen from orbit is a dot.
 */

/** Tower mark sizes by zoom, in points. `null` = the camera has not reported. */
export function towerMarkSize(longitudeDeltaDeg: number | null): number {
  const span = longitudeDeltaDeg ?? 4;
  if (span < 1) return 14;
  if (span < 4) return 11;
  if (span < 12) return 9;
  return 7;
}

/**
 * The blazing tower is deliberately larger than its neighbours.
 *
 * At night the chain *is* the position of the signal, so the current link has to
 * be the loudest thing on the map — the job the drifting ember does by day.
 */
export const CURRENT_TOWER_SCALE = 1.9;

/** Lit-but-passed towers hold their glow; they are the trail. */
export const PASSED_TOWER_OPACITY = 0.85;
/** Towers still waiting are stone: present, findable, quiet. */
export const AHEAD_TOWER_OPACITY = 0.4;
