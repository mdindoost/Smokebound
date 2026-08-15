/**
 * Where the sun is (MECHANICS-V2 §1, REDTEAM F32).
 *
 * Day or night is a property of a cell at an instant, and it is the one input to
 * this whole system that costs nothing to know: solar elevation is closed-form,
 * so there is no forecast product, no network call, no cache, and none of the
 * failure modes that produced F4, F28 and F31. A cell's day/night state is
 * knowable for any moment, past or future, for free — which is exactly what
 * makes counsel affordable across candidate departure times.
 *
 * **This module is the single definition, used by both the engine and the app**
 * (F32). If the router and the map ever computed dusk separately they would
 * eventually disagree, and the player would watch a fire burn on the screen
 * while the engine charged daylight speed. The precedent is `alongTrackWind` in
 * ./wind.ts, extracted for the same reason after the same risk was noticed.
 *
 * Precision: the terminator sweeps about 25 km/min at CONUS latitudes and our
 * cells are 50 km across, so ±0.1° of elevation — roughly ±1 km of terminator
 * position — is two orders of magnitude finer than the grid. The low-precision
 * NOAA formulation below is ample. Nothing here needs an ephemeris.
 */

import type { LatLng } from './types.js';

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

/** Julian date from a JS instant. */
function julianDate(at: Date): number {
  return at.getTime() / 86_400_000 + 2_440_587.5;
}

/**
 * Solar elevation in degrees above the horizon, negative below it.
 *
 * Low-precision NOAA solar position: mean longitude and anomaly from the day
 * number, an equation-of-centre correction for the Earth's eccentric orbit, then
 * the usual spherical-triangle projection onto the observer's horizon.
 */
export function solarElevationDeg(at: Date, point: LatLng): number {
  const n = julianDate(at) - 2_451_545.0;

  // Mean longitude and mean anomaly of the sun.
  const meanLongitude = (280.46 + 0.985_647_4 * n) % 360;
  const meanAnomaly = ((357.528 + 0.985_600_3 * n) % 360) * RAD;

  // Ecliptic longitude: mean longitude plus the equation of the centre.
  const eclipticLongitude =
    (meanLongitude + 1.915 * Math.sin(meanAnomaly) + 0.02 * Math.sin(2 * meanAnomaly)) * RAD;

  const obliquity = (23.439 - 0.000_000_4 * n) * RAD;
  const declination = Math.asin(Math.sin(obliquity) * Math.sin(eclipticLongitude));
  const rightAscension = Math.atan2(
    Math.cos(obliquity) * Math.sin(eclipticLongitude),
    Math.cos(eclipticLongitude),
  );

  // Greenwich mean sidereal time → local sidereal time → hour angle.
  const gmstHours = (18.697_374_558 + 24.065_709_824_419_08 * n) % 24;
  const localSidereal = (((gmstHours * 15 + point.lng) % 360) + 360) % 360 * RAD;
  const hourAngle = localSidereal - rightAscension;

  const latitude = point.lat * RAD;
  return (
    Math.asin(
      Math.sin(latitude) * Math.sin(declination) +
        Math.cos(latitude) * Math.cos(declination) * Math.cos(hourAngle),
    ) * DEG
  );
}

/**
 * Is it night here, now?
 *
 * `twilightDeg` is the elevation below which we call it dark — civil twilight
 * (−6°) by ruling. See MECHANICS-V2 §1.1 for why not sunset (0°, too early: a
 * smoke column still reads for half an hour after the sun goes down) and why not
 * nautical (−12°, too late: it has plainly been dark for a while by then).
 */
export function isNight(at: Date, point: LatLng, twilightDeg: number): boolean {
  return solarElevationDeg(at, point) < twilightDeg;
}

const MINUTE_MS = 60_000;
/** A day and a bit: enough to find the next crossing at any latitude we serve. */
const SEARCH_LIMIT_MINUTES = 60 * 26;

/**
 * The next moment this place crosses into night, or into day.
 *
 * Coarse scan to bracket the crossing, then bisection to the second. Used by
 * counsel to offer "at dusk" as a candidate departure (F37: the *origin's* dusk
 * — the sender's own sky, the one out of their window).
 *
 * Returns null when no crossing happens inside the search window. CONUS never
 * sees a polar day, but the function is honest rather than assuming: the caller
 * simply has no dusk to offer, which is the right answer above the Arctic circle
 * and the right answer if someone widens the launch region.
 */
export function nextTransition(
  from: Date,
  point: LatLng,
  twilightDeg: number,
  into: 'night' | 'day',
): Date | null {
  const want = into === 'night';
  let previous = from;
  let previousIsNight = isNight(from, point, twilightDeg);

  for (let minutes = 5; minutes <= SEARCH_LIMIT_MINUTES; minutes += 5) {
    const at = new Date(from.getTime() + minutes * MINUTE_MS);
    const nowNight = isNight(at, point, twilightDeg);

    if (nowNight !== previousIsNight && nowNight === want) {
      // Bracketed: [previous, at] contains the crossing. Bisect to the second.
      let low = previous.getTime();
      let high = at.getTime();
      while (high - low > 1000) {
        const mid = Math.floor((low + high) / 2);
        if (isNight(new Date(mid), point, twilightDeg) === want) high = mid;
        else low = mid;
      }
      return new Date(high);
    }
    previous = at;
    previousIsNight = nowNight;
  }
  return null;
}

/** The next dusk at this place: the moment it becomes night. */
export function nextDusk(from: Date, point: LatLng, twilightDeg: number): Date | null {
  return nextTransition(from, point, twilightDeg, 'night');
}

/** The next dawn at this place: the moment it becomes day. */
export function nextDawn(from: Date, point: LatLng, twilightDeg: number): Date | null {
  return nextTransition(from, point, twilightDeg, 'day');
}
