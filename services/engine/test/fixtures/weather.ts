/**
 * Synthetic weather for router tests (ARCHITECTURE §9: "fixture storms — wall,
 * pocket, full blockade").
 *
 * Cells left out of a fixture are *absent* from the snapshot, which the router
 * fails open to clear (MECHANICS §2.1). So "clear skies everywhere" is the empty
 * fixture, and each test only has to describe its storm.
 */

import {
  MECHANICS_DEFAULTS,
  MechanicsConfig,
  cellId,
  formatCellId,
  mechanicsSeedRows,
  parseCellId,
} from '@smoke/shared';
import type { CellId, LatLng, WeatherCondition } from '@smoke/shared';

import { snapshotFrom } from '../../src/weather/types.js';
import type { CellWeather, WeatherSnapshot } from '../../src/weather/types.js';

export const CONFIG: MechanicsConfig = MechanicsConfig.fromRows(mechanicsSeedRows());

export const FIXED_TIME = new Date('2026-08-14T12:00:00.000Z');

export interface WeatherPatch {
  condition?: WeatherCondition;
  impassable?: boolean;
  windMph?: number;
  windDirFromDeg?: number;
  weatherUnknown?: boolean;
}

export function cellWeather(cell: CellId, patch: WeatherPatch = {}): CellWeather {
  const condition = patch.condition ?? 'clear';
  return {
    cell,
    condition,
    windMph: patch.windMph ?? 0,
    windDirFromDeg: patch.windDirFromDeg ?? 0,
    timeMult: MECHANICS_DEFAULTS['weather.time_mult'][condition],
    impassable: patch.impassable ?? false,
    weatherUnknown: patch.weatherUnknown ?? false,
    fetchedAt: FIXED_TIME,
    source: 'nws',
  };
}

/** Build a snapshot from `[cells, patch]` pairs; later pairs win. */
export function weatherFixture(
  ...layers: [readonly CellId[], WeatherPatch][]
): WeatherSnapshot {
  const byCell = new Map<CellId, CellWeather>();
  for (const [cells, patch] of layers) {
    for (const cell of cells) byCell.set(cell, cellWeather(cell, patch));
  }
  return snapshotFrom(byCell.values());
}

/** Every cell in an inclusive row/col rectangle. */
export function cellRect(
  rows: [number, number],
  cols: [number, number],
): CellId[] {
  const out: CellId[] = [];
  for (let row = rows[0]; row <= rows[1]; row++) {
    for (let col = cols[0]; col <= cols[1]; col++) out.push(formatCellId({ row, col }));
  }
  return out;
}

export const rowOf = (cell: CellId): number => parseCellId(cell).row;
export const colOf = (cell: CellId): number => parseCellId(cell).col;

/** Landmarks used across the MECHANICS §7 worked examples. */
export const PLACES = {
  newark: { lat: 40.7357, lng: -74.1724 },
  chicago: { lat: 41.8781, lng: -87.6298 },
  philadelphia: { lat: 39.9526, lng: -75.1652 },
  miami: { lat: 25.7617, lng: -80.1918 },
  denver: { lat: 39.7392, lng: -104.9903 },
  charleston: { lat: 32.7765, lng: -79.9311 },
} satisfies Record<string, LatLng>;

export const CELLS = {
  newark: cellId(PLACES.newark),
  chicago: cellId(PLACES.chicago),
  philadelphia: cellId(PLACES.philadelphia),
  miami: cellId(PLACES.miami),
  denver: cellId(PLACES.denver),
  charleston: cellId(PLACES.charleston),
} as const;
