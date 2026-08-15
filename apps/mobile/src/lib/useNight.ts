/**
 * "Is it night over that fire?" — asked the same way everywhere (M5.6).
 *
 * Flock, the Ledger and Settings all describe somebody's fire, and a fire
 * burning at 3 AM should read differently from one banked at noon. Each screen
 * needs the twilight threshold and the visuals flag from `mechanics_config`, and
 * none of them should be deciding what dusk is on its own — that is
 * `packages/shared`'s sun module, and only that (REDTEAM F32).
 *
 * Returns a predicate rather than a boolean: a flock list holds fires in several
 * time zones, and the terminator runs between them.
 */

import { useEffect, useState } from 'react';
import { cellCenter, isNight } from '@smoke/shared';

import type { DataGateway, MechanicsView } from './gateway';
import { sunNow } from './devSun';

export function useNightAt(gateway: DataGateway): (cell: string | null | undefined) => boolean {
  const [mechanics, setMechanics] = useState<MechanicsView | null>(null);

  useEffect(() => {
    void gateway.mechanics().then(setMechanics).catch(() => setMechanics(null));
  }, [gateway]);

  return (cell) => {
    if (mechanics === null || !mechanics.nightVisuals) return false;
    if (cell === null || cell === undefined || cell === '') return false;
    try {
      return isNight(sunNow(new Date()), cellCenter(cell), mechanics.twilightElevationDeg);
    } catch {
      // An unparseable cell is not a reason to break a list.
      return false;
    }
  };
}
