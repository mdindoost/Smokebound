/**
 * Weather domain types (MECHANICS §2.1, ARCHITECTURE §6.1).
 *
 * `time_mult` is a TIME multiplier — higher is slower (REDTEAM F11). Wind is
 * stored raw (speed + direction) because its multiplier depends on the direction
 * of travel, which only the router knows.
 */

import type { CellId, WeatherCondition } from '@smoke/shared';

/** Where a snapshot entry came from — useful in logs, tests and the ledger. */
export type WeatherSource =
  /** Fresh from NWS this pass. */
  | 'nws'
  /** Cached row still inside its TTL. */
  | 'cache'
  /** Cached row past its TTL, served because NWS was unavailable (REDTEAM F4). */
  | 'stale'
  /** No usable data: treated as clear and flagged (MECHANICS §2.1 fail-open). */
  | 'fail_open'
  /** Open ocean: structurally impassable, never fetched (MECHANICS §1.1). */
  | 'ocean';

export interface CellWeather {
  cell: CellId;
  condition: WeatherCondition;
  /** Sustained wind in mph. */
  windMph: number;
  /** Degrees the wind blows *from*, meteorological convention (NWS). */
  windDirFromDeg: number;
  /** Time multiplier from the MECHANICS §2.1 table. */
  timeMult: number;
  /** True only for an active NWS severe warning/watch, or open ocean. */
  impassable: boolean;
  /** Fail-open flag: we are guessing "clear" because we have no data. */
  weatherUnknown: boolean;
  fetchedAt: Date;
  source: WeatherSource;
}

/** A read-only view of the weather the router plans against. */
export interface WeatherSnapshot {
  get(cell: CellId): CellWeather | undefined;
  readonly size: number;
  cells(): Iterable<CellId>;
}

export function snapshotFrom(entries: Iterable<CellWeather>): WeatherSnapshot {
  const map = new Map<CellId, CellWeather>();
  for (const entry of entries) map.set(entry.cell, entry);
  return {
    get: (cell) => map.get(cell),
    get size() {
      return map.size;
    },
    cells: () => map.keys(),
  };
}
