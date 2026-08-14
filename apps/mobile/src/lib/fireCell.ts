/**
 * Turning a coordinate into a fire, with no Expo dependency — so the rule can be
 * tested, and reused, without the permission machinery around it.
 */

import { cellId, isTraversable } from '@smoke/shared';

export type FireResult =
  | { ok: true; cell: string }
  | { ok: false; reason: 'denied' | 'unavailable' | 'outside_region'; message: string };

export const OUTSIDE_REGION =
  'SMOKE only covers the continental US for now — the weather service it reads stops at the border.';

/** The cell a coordinate falls in, if smoke could ever be there. */
export function cellFromCoordinates(lat: number, lng: number): FireResult {
  try {
    const cell = cellId({ lat, lng });
    if (!isTraversable(cell)) {
      return { ok: false, reason: 'outside_region', message: OUTSIDE_REGION };
    }
    return { ok: true, cell };
  } catch {
    return { ok: false, reason: 'outside_region', message: OUTSIDE_REGION };
  }
}
