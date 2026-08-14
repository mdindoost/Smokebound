/**
 * Generates the static land mask (MECHANICS §1.1, ARCHITECTURE §5).
 *
 *   npm run generate:land-mask --workspace packages/shared
 *
 * Source: Natural Earth 1:10m land polygons, shipped as TopoJSON by the
 * `world-atlas` package (a dev dependency — the app never loads it at runtime).
 * Output: `src/geo/generated/landMask.ts`, committed to the repo. It is
 * generated data, not a tunable: it changes only when the grid changes.
 *
 * A cell counts as land if ANY of the sample points inside it falls on land, so
 * a cell holding a sliver of coastline is land. That bias is deliberate —
 * over-including coast is harmless, under-including it would strand a real user.
 *
 * Method: scanline even-odd containment. For each sample latitude we compute
 * every ring crossing once, sort them, then answer all longitudes on that line by
 * counting crossings to the east. Even-odd handles lake holes for free.
 */

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { feature } from 'topojson-client';
import type { Topology } from 'topojson-specification';
import type { Feature, MultiPolygon, Polygon, Position } from 'geojson';

import { GRID, cellBounds, formatCellId } from '../src/geo/grid.js';

// world-atlas ships plain JSON; import it the way Node reads data files.
const landTopology = (await import('world-atlas/land-10m.json', {
  with: { type: 'json' },
})) as unknown as { default: Topology };

const SOURCE = 'Natural Earth 1:10m land, via world-atlas land-10m.json';

/** Sample offsets within a cell, as fractions of its width/height. */
const SAMPLE_OFFSETS = [0.1, 0.3, 0.5, 0.7, 0.9];

const OUT_PATH = fileURLToPath(new URL('../src/geo/generated/landMask.ts', import.meta.url));

// ---------------------------------------------------------------------------
// Collect the rings that could possibly touch the launch grid.
// ---------------------------------------------------------------------------

type Ring = Position[];

function collectRings(geometry: Polygon | MultiPolygon): Ring[] {
  if (geometry.type === 'Polygon') return geometry.coordinates;
  return geometry.coordinates.flat();
}

// `objects.land` is a GeometryCollection in world-atlas, so `feature()` hands
// back a FeatureCollection; older/smaller builds hand back a single Feature.
const landGeoJson = feature(landTopology.default, landTopology.default.objects['land']!) as
  | Feature<Polygon | MultiPolygon>
  | { type: 'FeatureCollection'; features: Feature<Polygon | MultiPolygon>[] };

const landGeometries: (Polygon | MultiPolygon)[] =
  landGeoJson.type === 'FeatureCollection'
    ? landGeoJson.features.map((f) => f.geometry)
    : [landGeoJson.geometry];

const PAD = 1; // degrees of slack around the grid extent
const { extent } = GRID;

const rings = landGeometries.flatMap(collectRings).filter((ring) => {
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
});

console.log(
  `${rings.length} rings intersect the launch grid ` +
    `(${rings.reduce((n, r) => n + r.length, 0).toLocaleString()} vertices)`,
);

// ---------------------------------------------------------------------------
// Scanline containment
// ---------------------------------------------------------------------------

/** Longitudes where the rings cross a given latitude, sorted ascending. */
function crossingsAtLatitude(lat: number): number[] {
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

/** Even-odd test: odd number of crossings strictly east of `lng` means inside. */
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
// Rasterise the grid
// ---------------------------------------------------------------------------

const maskRows: string[] = [];
let landCells = 0;

for (let row = 0; row < GRID.rows; row++) {
  const bounds = cellBounds(formatCellId({ row, col: 0 }));
  const height = bounds.north - bounds.south;

  // One scanline per sample latitude in this row, reused across all columns.
  const scanlines = SAMPLE_OFFSETS.map((f) => crossingsAtLatitude(bounds.south + f * height));

  let line = '';
  for (let col = 0; col < GRID.cols; col++) {
    const cell = cellBounds(formatCellId({ row, col }));
    const width = cell.east - cell.west;
    let isLand = false;

    outer: for (const scanline of scanlines) {
      for (const f of SAMPLE_OFFSETS) {
        if (isInside(scanline, cell.west + f * width)) {
          isLand = true;
          break outer;
        }
      }
    }

    line += isLand ? '#' : '.';
    if (isLand) landCells++;
  }
  maskRows.push(line);
  if ((row + 1) % 10 === 0) console.log(`  row ${row + 1}/${GRID.rows}`);
}

// ---------------------------------------------------------------------------
// Emit
// ---------------------------------------------------------------------------

// Rows are emitted north-first so the committed file reads like a map of the US.
const northFirst = [...maskRows].reverse();

const file = `/**
 * GENERATED FILE — DO NOT EDIT BY HAND.
 *
 * Per-cell land mask for the launch grid (MECHANICS §1.1, ARCHITECTURE §5).
 * Regenerate with: npm run generate:land-mask --workspace packages/shared
 *
 * Source: ${SOURCE}
 * A cell is land ('#') if any of ${SAMPLE_OFFSETS.length ** 2} sample points inside it falls on land.
 *
 * LAND_MASK_ROWS[0] is the NORTHERNMOST row (so the array reads like a map);
 * index into it with \`GRID.rows - 1 - row\`. Column 0 is the westernmost.
 */

export const LAND_MASK_META = {
  source: ${JSON.stringify(SOURCE)},
  rows: ${GRID.rows},
  cols: ${GRID.cols},
  samplesPerCell: ${SAMPLE_OFFSETS.length ** 2},
  landCells: ${landCells},
  /** Signature of the grid this mask was rasterised against. */
  gridSignature: ${JSON.stringify(gridSignature())},
} as const;

/** '#' = land, '.' = water. North-first; see the note above. */
export const LAND_MASK_ROWS: readonly string[] = [
${northFirst.map((r) => `  '${r}',`).join('\n')}
];
`;

function gridSignature(): string {
  return (
    `${GRID.rows}x${GRID.cols}@${GRID.cellKm}km/` +
    `${GRID.bbox.min_lat},${GRID.bbox.min_lng},${GRID.bbox.max_lat},${GRID.bbox.max_lng}`
  );
}

writeFileSync(OUT_PATH, file, 'utf8');

console.log(
  `\nWrote ${OUT_PATH}\n` +
    `  ${landCells} land cells of ${GRID.cellCount} ` +
    `(${((100 * landCells) / GRID.cellCount).toFixed(1)}%)`,
);
