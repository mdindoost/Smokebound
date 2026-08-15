/**
 * When the smoke met the terminator (M5.6).
 *
 * No sunset lines had ever appeared in the Ledger, and the diagnosis was simple:
 * nothing emitted them. The engine records SENT, DEPARTED, GARBLED, STRANDED,
 * RESUMED, DELIVERED, LOST — and no event for the sky changing.
 *
 * These are derived on the client instead of added to the engine's event stream,
 * for one reason: a terminator crossing is **deterministic**. Given the route,
 * the segment ETAs and the sun, it is not a fact the engine knows and the client
 * does not — it is arithmetic both sides can do, like the tower marks on the map.
 * Adding rows to `events` for something recomputable would be storing a
 * derivation.
 *
 * **DESIGN.md V7 still binds.** A crossing is only reported for a leg the
 * *engine* has confirmed the smoke is past — `confirmedCells`, not the
 * interpolated position. The client may do the arithmetic; it may not use it to
 * claim the smoke has been somewhere the server has not agreed it has been.
 */

import { cellCenter, isNight, towerNameFor } from '@smoke/shared';
import type { CellId } from '@smoke/shared';

import type { SegmentEta } from './flight';

export interface Crossing {
  at: string;
  into: 'night' | 'day';
  cell: CellId;
  line: string;
}

export function crossingsAlong(
  segments: readonly SegmentEta[] | null,
  confirmed: readonly CellId[],
  twilightElevationDeg: number,
): Crossing[] {
  if (!segments || segments.length < 2) return [];

  const confirmedSet = new Set(confirmed);
  const out: Crossing[] = [];
  let previous: boolean | null = null;

  for (const segment of segments) {
    const at = new Date(segment.eta);
    if (Number.isNaN(at.getTime())) continue;
    const night = isNight(at, cellCenter(segment.cell), twilightElevationDeg);

    if (previous !== null && night !== previous && confirmedSet.has(segment.cell)) {
      const where = towerNameFor(segment.cell);
      out.push({
        at: segment.eta,
        into: night ? 'night' : 'day',
        cell: segment.cell,
        line: night
          ? where === null
            ? 'Dusk caught the smoke. The tower lit its fire.'
            : `Dusk over ${where}. The tower lit its fire.`
          : where === null
            ? 'First light. The fire gave way to smoke.'
            : `First light over ${where}. The fire gave way to smoke.`,
      });
    }
    previous = night;
  }
  return out;
}
