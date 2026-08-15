/**
 * How many towers a map can carry (DESIGN.md, tower density — the open question
 * M5 could not answer without a long route on a real screen).
 *
 * On a two-cell hop to the Keeper, every tower fits and the map looks like a
 * map. On a sixty-cell route to Colorado the same rule draws sixty marks across
 * eleven hundred miles of screen, they tile edge to edge, and the result is a
 * beige caterpillar lying on top of the route line it was supposed to decorate.
 * The first person to see one said it looked messy, which is the correct review.
 *
 * So the map thins them and the Ledger does not. A timeline is a scroll and can
 * afford every tower the smoke passed; a map is a fixed rectangle and cannot.
 * Both ends are always kept — where a signal starts and where it is going are
 * the two marks nobody would thank us for dropping.
 */

import type { CellId } from '@smoke/shared';

export interface Tower {
  cell: CellId;
  name: string;
}

/**
 * Roughly how many marks fit across a panel before they touch.
 *
 * Twelve was still too many. On a continental route they read as a picket fence
 * — a dozen identical triangles evenly spaced, which is a *pattern*, and a
 * pattern outweighs the single ember it is supposed to frame. The ember has to
 * be the hero of the panel; everything else is scenery.
 */
export const MAX_TOWER_MARKS = 7;

/**
 * How many marks a given zoom can carry.
 *
 * `longitudeDelta` is the panel's span in degrees — small when zoomed in, large
 * when the whole country is on screen. Zoomed right in there is room for every
 * tower and each one is a real landmark you could point at; zoomed out they are
 * decoration and should thin toward nothing.
 */
export function marksForZoom(longitudeDelta: number | null): number {
  if (longitudeDelta === null) return MAX_TOWER_MARKS;
  if (longitudeDelta < 1) return 12; // a city or two: labels are legible
  if (longitudeDelta < 4) return 9;
  if (longitudeDelta < 12) return MAX_TOWER_MARKS;
  return 5; // a continent: endpoints and a few waypoints, nothing more
}

/**
 * Evenly spaced towers, both ends kept.
 *
 * Even spacing rather than "the biggest towns": a route's marks are there to
 * show the *path*, and dropping the middle of the country because Ohio has no
 * large city would draw a line that looks like it teleports.
 */
export function thinTowers(towers: readonly Tower[], max: number = MAX_TOWER_MARKS): Tower[] {
  if (towers.length <= max) return [...towers];
  if (max <= 2) return [towers[0]!, towers[towers.length - 1]!];

  const kept: Tower[] = [];
  const step = (towers.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) {
    const tower = towers[Math.round(i * step)]!;
    // Rounding can land twice on the same tower at the ends; a Set would lose
    // the order we just went to the trouble of computing.
    if (kept[kept.length - 1]?.cell !== tower.cell) kept.push(tower);
  }
  return kept;
}
