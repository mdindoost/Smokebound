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

/**
 * The terminator: the line between day and night, drawn across the panel.
 *
 * Found by walking latitudes and, for each one, bisecting longitude for the
 * place where solar elevation crosses the twilight threshold. Cheap — the sun is
 * closed-form (MECHANICS-V2 §1.2) — and it turns an abstract mechanic into
 * something a player can point at: *that* is why the smoke speeds up there.
 *
 * Returns an empty list when no crossing exists in view, which over CONUS means
 * the whole visible region is in one regime.
 */
export function terminatorPath(
  at: Date,
  twilightElevationDeg: number,
  bounds: { minLat: number; maxLat: number; minLng: number; maxLng: number },
  samples = 24,
): LatLng[] {
  const points: LatLng[] = [];

  for (let i = 0; i <= samples; i++) {
    const lat = bounds.minLat + ((bounds.maxLat - bounds.minLat) * i) / samples;

    let low = bounds.minLng;
    let high = bounds.maxLng;
    const nightAtLow = isNight(at, { lat, lng: low }, twilightElevationDeg);
    if (nightAtLow === isNight(at, { lat, lng: high }, twilightElevationDeg)) continue;

    // A crossing is bracketed on this latitude; find it to about a kilometre.
    for (let step = 0; step < 18; step++) {
      const mid = (low + high) / 2;
      if (isNight(at, { lat, lng: mid }, twilightElevationDeg) === nightAtLow) low = mid;
      else high = mid;
    }
    points.push({ lat, lng: (low + high) / 2 });
  }
  return points;
}
