/**
 * Names every routable cell after the nearest place, so the tower layer can say
 * "passed the Allegheny tower at 3:12 AM" without a network call (SPEC §3 v1.1).
 *
 *   npm run generate:tower-names --workspace packages/shared
 *
 * Source: the GeoNames extract shipped by `all-the-cities` (a dev dependency —
 * the app never loads it). Output: `src/geo/generated/towerNames.ts`, committed.
 *
 * The towers are cosmetic. They name the sky the smoke passes through; they
 * change no mechanics, and nothing in the router or the crons reads this table.
 */

import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { GRID, cellCenter, formatCellId } from '../src/geo/grid.js';
import { isTraversable } from '../src/geo/land.js';

const require = createRequire(import.meta.url);
const allCities = require('all-the-cities') as {
  name: string;
  country: string;
  population: number;
  loc: { coordinates: [number, number] };
}[];

const OUT_PATH = fileURLToPath(new URL('../src/geo/generated/towerNames.ts', import.meta.url));

/** Places big enough to be worth naming a tower after. */
const MIN_POPULATION = 1_000;

interface Place {
  name: string;
  lat: number;
  lng: number;
}

const places: Place[] = allCities
  .filter((city) => city.country === 'US' && city.population >= MIN_POPULATION)
  .map((city) => ({
    name: city.name,
    lng: city.loc.coordinates[0],
    lat: city.loc.coordinates[1],
  }))
  .filter(
    (place) =>
      place.lat >= GRID.extent.min_lat - 1 &&
      place.lat <= GRID.extent.max_lat + 1 &&
      place.lng >= GRID.extent.min_lng - 1 &&
      place.lng <= GRID.extent.max_lng + 1,
  );

console.log(`${places.length.toLocaleString()} US places inside the launch region`);

// Bucket by whole degree of latitude so the nearest-place search stays cheap.
const buckets = new Map<number, Place[]>();
for (const place of places) {
  const key = Math.floor(place.lat);
  buckets.set(key, [...(buckets.get(key) ?? []), place]);
}

function nearestPlace(lat: number, lng: number): Place | null {
  let best: Place | null = null;
  let bestScore = Infinity;
  const cos = Math.cos((lat * Math.PI) / 180);
  const base = Math.floor(lat);

  // Expanding rings of latitude buckets; stop as soon as the best candidate is
  // closer than the next ring could possibly bring.
  for (let ring = 0; ring <= 8; ring++) {
    for (const key of ring === 0 ? [base] : [base - ring, base + ring]) {
      for (const place of buckets.get(key) ?? []) {
        const dLat = place.lat - lat;
        const dLng = (place.lng - lng) * cos;
        const score = dLat * dLat + dLng * dLng;
        if (score < bestScore) {
          bestScore = score;
          best = place;
        }
      }
    }
    if (best !== null && Math.sqrt(bestScore) <= ring) break;
  }
  return best;
}

// ---------------------------------------------------------------------------

const names: string[] = [];
const points: [number, number][] = [];
// Keyed by name *and* coordinates, not name alone: there are a dozen
// Springfields, and giving them one shared entry would put the Illinois tower's
// pin in Massachusetts. Names may repeat in the table; places may not.
const nameIndex = new Map<string, number>();
const indices: string[] = [];
let named = 0;

for (let row = 0; row < GRID.rows; row++) {
  for (let col = 0; col < GRID.cols; col++) {
    const cell = formatCellId({ row, col });
    if (!isTraversable(cell)) {
      indices.push('...');
      continue;
    }
    const centre = cellCenter(cell);
    const place = nearestPlace(centre.lat, centre.lng);
    if (place === null) {
      indices.push('...');
      continue;
    }
    const key = `${place.name}@${place.lat.toFixed(4)},${place.lng.toFixed(4)}`;
    let index = nameIndex.get(key);
    if (index === undefined) {
      index = names.length;
      names.push(place.name);
      points.push([round4(place.lat), round4(place.lng)]);
      nameIndex.set(key, index);
    }
    indices.push(index.toString(36).padStart(3, '0'));
    named++;
  }
  if ((row + 1) % 10 === 0) console.log(`  row ${row + 1}/${GRID.rows}`);
}

if (names.length > 36 ** 3) throw new Error('too many distinct names for a 3-digit base-36 index');

const file = `/**
 * GENERATED FILE — DO NOT EDIT BY HAND.
 *
 * A beacon-tower name for every routable cell, from the nearest place of 1,000
 * people or more (GeoNames via all-the-cities). Cosmetic only — the tower layer
 * names the sky, and changes no mechanics (SPEC §3 v1.1).
 *
 * Regenerate with: npm run generate:tower-names --workspace packages/shared
 *
 * TOWER_INDEX is row-major over the whole grid, three base-36 digits per cell,
 * '...' where no tower stands (open ocean, foreign land).
 */

export const TOWER_NAMES: readonly string[] = ${JSON.stringify(names)};

/**
 * Where each tower actually stands: [lat, lng] of the place itself, parallel to
 * TOWER_NAMES.
 *
 * A cell centre is a point of arithmetic, not geography — the centroid of the
 * cell covering Little Falls, NJ lands in the Cedar Grove Reservoir, so a fire
 * drawn there appears to burn on open water. These are the real coordinates, for
 * drawing only. Distance, ETA and routing stay on cell centres; see
 * towerPoint() in towers.ts for the guard that keeps a pin inside its own cell.
 */
export const TOWER_POINTS: readonly (readonly [number, number])[] =
${JSON.stringify(points)};

export const TOWER_INDEX =
${chunk(indices.join(''), 96)
  .map((line) => `  '${line}'`)
  .join(' +\n')};
`;

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function chunk(value: string, size: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < value.length; i += size) out.push(value.slice(i, i + size));
  return out;
}

writeFileSync(OUT_PATH, file, 'utf8');

console.log(
  `\nWrote ${OUT_PATH}\n` +
    `  ${named.toLocaleString()} cells named from ${names.length.toLocaleString()} distinct places`,
);
