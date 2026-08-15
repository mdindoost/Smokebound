/**
 * What the sky is doing to this smoke, in a sentence.
 *
 * The data is already on the phone — the flight view fetches `weather_cells` for
 * the whole route to mark the unforecast ones — but until now none of it was
 * said out loud. A player watching an ETA slip had no way to learn *why*, which
 * makes the weather feel like randomness instead of the mechanic it is.
 *
 * The head/tail geometry comes from `@smoke/shared` — the same function the
 * router uses to price the hop — so the sentence and the penalty can never
 * describe different weather.
 */

import { cellCenter, compassPoint, initialBearingDeg, towerNameFor, windRelation } from '@smoke/shared';
import type { CellId } from '@smoke/shared';

import type { CellWeatherView } from './gateway';

export interface WindReading {
  line: string;
  /** True when the sky is actively costing this message time. */
  adverse: boolean;
}

/** The bearing the smoke is travelling on right now, or null at the end. */
function travelBearing(route: readonly CellId[], leg: number): number | null {
  const from = route[leg];
  const to = route[leg + 1];
  if (from === undefined || to === undefined) return null;
  return initialBearingDeg(cellCenter(from), cellCenter(to));
}

/**
 * Conditions in the cell the smoke is in, phrased for the flight view.
 *
 * Returns null rather than inventing a line: a cell we never fetched is flagged
 * elsewhere as unforecast, and "calm" would be a claim we cannot make.
 */
export function windReading(
  route: readonly CellId[],
  leg: number,
  weather: Map<string, CellWeatherView>,
): WindReading | null {
  const cell = route[leg];
  if (cell === undefined) return null;

  const here = weather.get(cell);
  if (here === undefined || here.weatherUnknown) return null;

  const mph = here.windMph;
  const dir = here.windDir;
  if (mph === null || dir === null) return null;

  const bearing = travelBearing(route, leg);
  const relation = bearing === null ? 'calm' : windRelation(mph, dir, bearing);
  const speed = `${Math.round(mph)} mph ${compassPoint(dir)}`.trim();

  switch (relation) {
    case 'tailwind':
      return { line: `Winds ${speed} — a following wind, and it is making time.`, adverse: false };
    case 'headwind':
      return { line: `Winds ${speed} — a headwind. The smoke labours.`, adverse: true };
    case 'crosswind':
      return { line: `Winds ${speed} across the track — the column leans but holds.`, adverse: false };
    default:
      return { line: 'The air is still. The column stands straight.', adverse: false };
  }
}

/**
 * One line for a whole route, for the pre-send preview.
 *
 * Names the worst thing waiting rather than averaging: an average is the one
 * summary that describes no part of the journey, and a sender deciding whether
 * to light the fire wants to know about the gale over Pennsylvania, not the mean
 * windspeed between here and there.
 */
export function routeWindSummary(
  route: readonly CellId[],
  weather: Map<string, CellWeatherView>,
): string | null {
  if (route.length < 2) return null;

  let worst: { cell: CellId; mph: number } | null = null;
  let counted = 0;

  for (let leg = 0; leg < route.length - 1; leg++) {
    const cell = route[leg]!;
    const here = weather.get(cell);
    if (here === undefined || here.weatherUnknown) continue;
    if (here.windMph === null || here.windDir === null) continue;

    counted++;
    const bearing = travelBearing(route, leg);
    if (bearing === null) continue;
    if (windRelation(here.windMph, here.windDir, bearing) !== 'headwind') continue;
    if (worst === null || here.windMph > worst.mph) worst = { cell, mph: here.windMph };
  }

  if (counted === 0) return null;
  if (worst === null) return 'Light winds along the route.';

  const where = towerNameFor(worst.cell);
  return where === null
    ? 'Headwinds along the way will slow this signal.'
    : `Headwinds near ${where} will slow this signal.`;
}
