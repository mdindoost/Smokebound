/**
 * Generates the static land mask (MECHANICS §1.1, ARCHITECTURE §5).
 *
 *   npm run generate:land-mask --workspace packages/shared
 *
 * Two layers, rasterised identically from Natural Earth 1:10m data shipped by
 * the `world-atlas` package (a dev dependency — the app never loads it at
 * runtime):
 *
 *   land   — all land polygons (`land-10m.json`)
 *   us     — the United States admin-0 polygon (`countries-10m.json`, id 840)
 *
 * Every cell ends up as exactly one of:
 *
 *   '#'  US land        — routable
 *   '~'  foreign land   — impassable in v1 (REDTEAM F16: no NWS data there, so
 *                         fail-open would make Canada and Mexico free highways)
 *   '.'  water          — routable only within one cell of US land
 *
 * Border cells are decided by **majority sample**: of the sample points that
 * land on land at all, if at least half are inside the US the cell is US.
 * Ties go to the US, because the cost of wrongly excluding a border town
 * (an unroutable user) is worse than wrongly including a strip of Ontario.
 *
 * Method: scanline even-odd containment. For each sample latitude we compute
 * every ring crossing once, sort them, then answer all longitudes on that line
 * by counting crossings to the east. Even-odd handles lake holes for free.
 */

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { feature } from 'topojson-client';
import type { Topology } from 'topojson-specification';
import type { Feature, MultiPolygon, Polygon, Position } from 'geojson';

import { GRID, cellBounds, formatCellId } from '../src/geo/grid.js';

const landTopology = (await import('world-atlas/land-10m.json', {
  with: { type: 'json' },
})) as unknown as { default: Topology };

const countriesTopology = (await import('world-atlas/countries-10m.json', {
  with: { type: 'json' },
})) as unknown as { default: Topology };

const SOURCE =
  'Natural Earth 1:10m land + admin-0 (US, id 840), via world-atlas land-10m.json and countries-10m.json';

/** ISO 3166-1 numeric code for the United States, as Natural Earth ids it. */
const US_ID = '840';

/** Sample offsets within a cell, as fractions of its width/height. */
const SAMPLE_OFFSETS = [0.1, 0.3, 0.5, 0.7, 0.9];

const OUT_PATH = fileURLToPath(new URL('../src/geo/generated/landMask.ts', import.meta.url));

// ---------------------------------------------------------------------------
// Rings
// ---------------------------------------------------------------------------

type Ring = Position[];

function collectRings(geometry: Polygon | MultiPolygon): Ring[] {
  if (geometry.type === 'Polygon') return geometry.coordinates;
  return geometry.coordinates.flat();
}

type AnyFeature = Feature<Polygon | MultiPolygon> & { id?: string | number };

function featuresOf(topology: Topology, objectName: string): AnyFeature[] {
  const geojson = feature(topology, topology.objects[objectName]!) as
    | AnyFeature
    | { type: 'FeatureCollection'; features: AnyFeature[] };
  return geojson.type === 'FeatureCollection' ? geojson.features : [geojson];
}

const PAD = 1; // degrees of slack around the grid extent
const { extent } = GRID;

function nearTheGrid(ring: Ring): boolean {
  let minLng = Infinity;
  let maxLng = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  for (const [lng, lat] of ring as [number, number][]) {
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  return (
    maxLng >= extent.min_lng - PAD &&
    minLng <= extent.max_lng + PAD &&
    maxLat >= extent.min_lat - PAD &&
    minLat <= extent.max_lat + PAD
  );
}

const landRings = featuresOf(landTopology.default, 'land')
  .flatMap((f) => collectRings(f.geometry))
  .filter(nearTheGrid);

const usFeatures = featuresOf(countriesTopology.default, 'countries').filter(
  (f) => String(f.id) === US_ID,
);
if (usFeatures.length === 0) throw new Error('could not find the US in countries-10m.json');

const usRings = usFeatures.flatMap((f) => collectRings(f.geometry)).filter(nearTheGrid);

console.log(
  `land: ${landRings.length} rings (${landRings.reduce((n, r) => n + r.length, 0).toLocaleString()} vertices)\n` +
    `us:   ${usRings.length} rings (${usRings.reduce((n, r) => n + r.length, 0).toLocaleString()} vertices)`,
);

// ---------------------------------------------------------------------------
// Scanline containment
// ---------------------------------------------------------------------------

function crossingsAtLatitude(rings: Ring[], lat: number): number[] {
  const xs: number[] = [];
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i] as [number, number];
      const [xj, yj] = ring[j] as [number, number];
      if (yi > lat !== yj > lat) {
        xs.push(xi + ((lat - yi) / (yj - yi)) * (xj - xi));
      }
    }
  }
  return xs.sort((a, b) => a - b);
}

/** Even-odd test: an odd number of crossings strictly east of `lng` means inside. */
function isInside(sortedCrossings: number[], lng: number): boolean {
  let lo = 0;
  let hi = sortedCrossings.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sortedCrossings[mid]! <= lng) lo = mid + 1;
    else hi = mid;
  }
  return (sortedCrossings.length - lo) % 2 === 1;
}

// ---------------------------------------------------------------------------
// Rasterise
// ---------------------------------------------------------------------------

const maskRows: string[] = [];
let usCells = 0;
let foreignCells = 0;
let waterCells = 0;

for (let row = 0; row < GRID.rows; row++) {
  const rowBounds = cellBounds(formatCellId({ row, col: 0 }));
  const height = rowBounds.north - rowBounds.south;

  const latitudes = SAMPLE_OFFSETS.map((f) => rowBounds.south + f * height);
  const landScanlines = latitudes.map((lat) => crossingsAtLatitude(landRings, lat));
  const usScanlines = latitudes.map((lat) => crossingsAtLatitude(usRings, lat));

  let line = '';
  for (let col = 0; col < GRID.cols; col++) {
    const cell = cellBounds(formatCellId({ row, col }));
    const width = cell.east - cell.west;

    let landHits = 0;
    let usHits = 0;
    for (let s = 0; s < latitudes.length; s++) {
      for (const f of SAMPLE_OFFSETS) {
        const lng = cell.west + f * width;
        if (isInside(landScanlines[s]!, lng)) {
          landHits++;
          if (isInside(usScanlines[s]!, lng)) usHits++;
        }
      }
    }

    if (landHits === 0) {
      line += '.';
      waterCells++;
    } else if (usHits * 2 >= landHits) {
      line += '#';
      usCells++;
    } else {
      line += '~';
      foreignCells++;
    }
  }
  maskRows.push(line);
  if ((row + 1) % 10 === 0) console.log(`  row ${row + 1}/${GRID.rows}`);
}

// ---------------------------------------------------------------------------
// Emit
// ---------------------------------------------------------------------------

function gridSignature(): string {
  return (
    `${GRID.rows}x${GRID.cols}@${GRID.cellKm}km/` +
    `${GRID.bbox.min_lat},${GRID.bbox.min_lng},${GRID.bbox.max_lat},${GRID.bbox.max_lng}`
  );
}

// Rows are emitted north-first so the committed file reads like a map of the US.
const northFirst = [...maskRows].reverse();

const file = `/**
 * GENERATED FILE — DO NOT EDIT BY HAND.
 *
 * Per-cell land mask for the launch grid (MECHANICS §1.1, ARCHITECTURE §5).
 * Regenerate with: npm run generate:land-mask --workspace packages/shared
 *
 * Source: ${SOURCE}
 * Each cell is classified from ${SAMPLE_OFFSETS.length ** 2} sample points:
 *
 *   '#'  US land       — routable
 *   '~'  foreign land  — impassable in v1 (REDTEAM F16)
 *   '.'  water         — routable only within one cell of US land
 *
 * Border cells go to whichever country holds the majority of their land
 * samples; ties go to the US.
 *
 * LAND_MASK_ROWS[0] is the NORTHERNMOST row (so the array reads like a map);
 * index into it with \`GRID.rows - 1 - row\`. Column 0 is the westernmost.
 */

export const LAND_MASK_META = {
  source: ${JSON.stringify(SOURCE)},
  /** Bumped when the classification scheme changes, not when the data does. */
  maskVersion: 2,
  rows: ${GRID.rows},
  cols: ${GRID.cols},
  samplesPerCell: ${SAMPLE_OFFSETS.length ** 2},
  usLandCells: ${usCells},
  foreignLandCells: ${foreignCells},
  waterCells: ${waterCells},
  /** Signature of the grid this mask was rasterised against. */
  gridSignature: ${JSON.stringify(gridSignature())},
} as const;

/** '#' US land, '~' foreign land, '.' water. North-first; see the note above. */
export const LAND_MASK_ROWS: readonly string[] = [
${northFirst.map((r) => `  '${r}',`).join('\n')}
];
`;

writeFileSync(OUT_PATH, file, 'utf8');

console.log(
  `\nWrote ${OUT_PATH}\n` +
    `  US land:      ${usCells}\n` +
    `  foreign land: ${foreignCells}\n` +
    `  water:        ${waterCells}\n` +
    `  total:        ${GRID.cellCount}`,
);
