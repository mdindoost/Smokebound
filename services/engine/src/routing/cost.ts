/**
 * Edge costs (MECHANICS §2, §2.2; ARCHITECTURE §6.2, as corrected by REDTEAM F11).
 *
 *   hours = (hop_km / speed.base_kmh) × weather_mult × wind_mult
 *
 * Every multiplier acts on TIME: higher is slower. There is deliberately no
 * "effective speed" anywhere in this file — that phrasing is what inverted the
 * multipliers in the first place.
 */

import { alongTrackWind, cellCenter, haversineKm, initialBearingDeg } from '@smoke/shared';
import type { CellId, MechanicsConfig } from '@smoke/shared';

import type { WeatherSnapshot } from '../weather/types.js';

/**
 * Length of one hop, in km.
 *
 * ARCHITECTURE §6.2 states the nominal form (`cell_km`, ×1.414 diagonally). We
 * use the true centre-to-centre distance instead, which *is* that number to
 * within the grid's own distortion (50 km orthogonal, 70.7 km diagonal at the
 * reference latitude) and which keeps the heuristic admissible everywhere — see
 * "would be inadmissible if hops were priced at a nominal 50 km" in
 * `test/routing/cost.test.ts` for the case where the nominal form breaks.
 */
export function hopDistanceKm(from: CellId, to: CellId): number {
  return haversineKm(cellCenter(from), cellCenter(to));
}

/**
 * Wind multiplier on time (MECHANICS §2.2), clamped to [0.7, 1.6].
 *
 * `windDirFromDeg` follows the meteorological convention NWS uses: the direction
 * the wind blows *from*. A tailwind is wind whose along-track component points
 * the way we are travelling.
 */
export function windMultiplier(
  windMph: number,
  windDirFromDeg: number,
  travelBearingDeg: number,
  config: MechanicsConfig,
): number {
  if (!Number.isFinite(windMph) || windMph <= 0) return 1;

  // Shared with the app, so the sentence on the flight screen and the penalty
  // in the router can never describe different weather.
  const alongTrackMph = alongTrackWind(windMph, windDirFromDeg, travelBearingDeg);

  if (alongTrackMph >= 0) {
    return Math.max(
      config.get('wind.tailwind_min_mult'),
      1 - config.get('wind.tailwind_coefficient_per_mph') * alongTrackMph,
    );
  }
  return Math.min(
    config.get('wind.headwind_max_mult'),
    1 + config.get('wind.headwind_coefficient_per_mph') * -alongTrackMph,
  );
}

/** The multipliers that apply when traversing `cell`, given a travel direction. */
export function cellMultipliers(
  cell: CellId,
  travelBearingDeg: number,
  weather: WeatherSnapshot,
  config: MechanicsConfig,
): { weatherMult: number; windMult: number; unknown: boolean } {
  const entry = weather.get(cell);
  if (!entry) {
    // A cell we have never fetched (REDTEAM F29).
    //
    // This used to price at `weather.unknown_time_mult` — 1.0, the fail-open
    // rule — which made the unexplored sky the cheapest terrain in the graph and
    // gave A* a positive reason to route through it. Fail-open was written to
    // answer "may an outage strand a message?" (no, F4). It was never asked
    // whether the router should *prefer* what nobody has looked at, and the
    // answer to that is no as well.
    //
    // Priced like overcast, unknown terrain is crossable but never inviting, and
    // a preview no longer has to buy the whole corridor before it dares quote.
    // Stranding semantics are untouched: this multiplies time, and only
    // `impassable` can stop a message.
    return { weatherMult: config.get('routing.unknown_cost_mult'), windMult: 1, unknown: true };
  }
  return {
    weatherMult: entry.timeMult,
    windMult: windMultiplier(entry.windMph, entry.windDirFromDeg, travelBearingDeg, config),
    unknown: entry.weatherUnknown,
  };
}

/**
 * Hours to move from one cell into an adjacent one. The weather that counts is
 * the weather of the cell being *entered* — that is the air the smoke has to get
 * through on this hop.
 */
export function hopHours(
  from: CellId,
  to: CellId,
  weather: WeatherSnapshot,
  config: MechanicsConfig,
): number {
  const bearing = initialBearingDeg(cellCenter(from), cellCenter(to));
  const { weatherMult, windMult } = cellMultipliers(to, bearing, weather, config);
  return (hopDistanceKm(from, to) / config.get('speed.base_kmh')) * weatherMult * windMult;
}

/**
 * A* heuristic (ARCHITECTURE §6.2, REDTEAM F3): straight-line distance flown at
 * the fastest the sky can ever be — full tailwind, `wind_mult` floor 0.7.
 * Admissible because no path is shorter than the great circle and no multiplier
 * product drops below that floor.
 */
export function heuristicHours(cell: CellId, dest: CellId, config: MechanicsConfig): number {
  const km = haversineKm(cellCenter(cell), cellCenter(dest));
  return (km * config.get('routing.heuristic_max_speed_factor')) / config.get('speed.base_kmh');
}
