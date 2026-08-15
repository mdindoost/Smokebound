/**
 * Fire at night (MECHANICS-V2 §1.3, REDTEAM F32).
 *
 * The smoke marker changes what it *is* after dark: by day a column of smoke,
 * by night a fire. This is theater, and it ships on by default —
 * `night.visuals_enabled` — because the app should always be honest about what
 * the sky looks like, and what the sky looks like does not depend on whether we
 * have switched on a multiplier.
 *
 * **The line that must not be crossed:** nothing here, and no copy anywhere,
 * may claim that fire is *faster* unless `night.enabled` is true. Showing a fire
 * describes the world; saying it travels faster is a claim about the model, and
 * until the mechanic is on it would be a false one.
 *
 * Day/night comes from `@smoke/shared`'s sun module — the same function the
 * router prices hops with. If these two ever computed dusk separately, the map
 * would eventually show a fire burning while the engine charged daylight speed,
 * and the player would be watching a lie about a mechanic they can see.
 */

import { isNight } from '@smoke/shared';
import type { CellId, LatLng } from '@smoke/shared';
import { cellCenter } from '@smoke/shared';

/** What the tower is burning at this place and moment. */
export type Regime = 'smoke' | 'fire';

export function regimeAt(
  at: Date,
  point: LatLng,
  twilightElevationDeg: number,
  visualsEnabled: boolean,
): Regime {
  if (!visualsEnabled) return 'smoke';
  return isNight(at, point, twilightElevationDeg) ? 'fire' : 'smoke';
}

/** The regime over a cell, for markers anchored to the grid. */
export function regimeInCell(
  at: Date,
  cell: CellId,
  twilightElevationDeg: number,
  visualsEnabled: boolean,
): Regime {
  return regimeAt(at, cellCenter(cell), twilightElevationDeg, visualsEnabled);
}

/**
 * One line about what the smoke is, right now.
 *
 * `mechanicsEnabled` is the F32 gate. With it false the copy describes the fire
 * and stops; with it true it may also say the fire is quicker, because by then
 * it is.
 */
export function regimeLine(regime: Regime, mechanicsEnabled: boolean): string {
  if (regime === 'smoke') return 'A column of smoke, climbing.';
  return mechanicsEnabled
    ? 'Burning as a fire now — the far towers see it sooner.'
    : 'Burning as a fire now, against the dark.';
}
