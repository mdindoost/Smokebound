/**
 * Which way the wind is helping, in one place.
 *
 * The engine turns wind into a time multiplier; the app turns the same wind into
 * a sentence. If those two disagree — the screen saying "a following wind" while
 * the router charges a headwind penalty — the app is lying about mechanics the
 * player can feel. So the geometry lives here once, and both read it.
 *
 * This file is geometry only. The coefficients and clamps that turn a component
 * into a multiplier are gameplay numbers and stay in `mechanics_config`
 * (ARCHITECTURE §10); nothing here decides how much a wind costs.
 */

/**
 * The component of the wind along the direction of travel, in the wind's own
 * units. Positive is a tailwind, negative a headwind.
 *
 * `windDirFromDeg` is the meteorological convention NWS reports in: the
 * direction the wind blows *from*. A south wind (180°) blows *toward* the north,
 * so it helps a smoke travelling north.
 */
export function alongTrackWind(
  windSpeed: number,
  windDirFromDeg: number,
  travelBearingDeg: number,
): number {
  if (!Number.isFinite(windSpeed) || windSpeed <= 0) return 0;
  if (!Number.isFinite(windDirFromDeg) || !Number.isFinite(travelBearingDeg)) return 0;

  const blowingToward = (windDirFromDeg + 180) % 360;
  const angle = ((travelBearingDeg - blowingToward + 540) % 360) - 180;
  return windSpeed * Math.cos((angle * Math.PI) / 180);
}

export type WindRelation = 'tailwind' | 'headwind' | 'crosswind' | 'calm';

/**
 * How a wind reads to a person watching the smoke.
 *
 * The crosswind band is deliberately wide: a wind mostly across the track barely
 * moves the multiplier, and calling it a headwind because the component is a
 * hair negative would make the copy feel arbitrary next to an ETA that did not
 * move.
 */
export function windRelation(
  windSpeed: number,
  windDirFromDeg: number,
  travelBearingDeg: number,
  calmThreshold = 3,
): WindRelation {
  if (!Number.isFinite(windSpeed) || windSpeed < calmThreshold) return 'calm';
  const along = alongTrackWind(windSpeed, windDirFromDeg, travelBearingDeg);
  if (Math.abs(along) < calmThreshold) return 'crosswind';
  return along > 0 ? 'tailwind' : 'headwind';
}

/** `247` → `WSW`, for reading a direction aloud. */
export function compassPoint(degrees: number): string {
  const POINTS = [
    'N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
    'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW',
  ];
  if (!Number.isFinite(degrees)) return '';
  const index = Math.round((((degrees % 360) + 360) % 360) / 22.5) % 16;
  return POINTS[index] ?? '';
}
