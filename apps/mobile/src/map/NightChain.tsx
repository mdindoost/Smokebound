/**
 * The night chain (M5.7).
 *
 * Device evidence at 3:29 AM: the night layer worked — fire-styled marker, night
 * copy — and the fire still *drifted across the map as a dot*. Which is wrong in
 * a way no amount of restyling fixes. **Fire does not travel.** Light does not
 * move along a route; towers kindle in sequence, and the signal's position is
 * *which tower is currently burning*.
 *
 * So after dark the drifting marker disappears entirely and the route's towers
 * become the signal:
 *
 *   - **passed** — lit, holding their glow: the trail behind
 *   - **current** — blazing, the loudest thing on the map, and the one thing
 *     that breathes (R23)
 *   - **ahead** — dark stone, waiting
 *
 * There is no traveling spark between them. The kindling *is* the motion, and
 * adding a moving dot on top would restate in the wrong idiom the very thing
 * this rendering exists to say.
 *
 * **Every link is server truth.** The blazing tower is the cell the engine has
 * confirmed (`current_leg`), never the interpolated position — DESIGN.md V7. By
 * day interpolation may run ahead cosmetically, because a dot between waypoints
 * is obviously an approximation. A *lit tower* is not: it is a claim that the
 * fire reached that station, and the client has no business making it.
 *
 * **R22 interaction.** By day the map thins towers to keep the ember the hero.
 * At night the towers are not labels — they are the signal — so the whole route
 * chain renders, name-change de-stuttering and all. Zoom still governs their
 * *size*, because a tower seen from orbit is a dot and one seen closely is a
 * landmark.
 */

import { Marker } from 'react-native-maps';
import { View } from 'react-native';
import { displayPoint } from '@smoke/shared';
import type { CellId } from '@smoke/shared';

import { chainFor } from './chain';
import type { ChainLink } from './chain';

import { sky } from '../design/sky';
import {
  AHEAD_TOWER_OPACITY,
  CURRENT_TOWER_SCALE,
  PASSED_TOWER_OPACITY,
  towerMarkSize,
} from '../design/marks';

export function TowerFlame({
  link,
  zoom,
}: {
  link: ChainLink;
  zoom: number | null;
}) {
  const base = towerMarkSize(zoom);
  const size = link.phase === 'current' ? base * CURRENT_TOWER_SCALE : base;

  const colour =
    link.phase === 'current'
      ? sky.chainCurrent
      : link.phase === 'passed'
        ? sky.chainPassed
        : sky.chainAhead;

  const opacity =
    link.phase === 'current' ? 1 : link.phase === 'passed' ? PASSED_TOWER_OPACITY : AHEAD_TOWER_OPACITY;

  return (
    <Marker
      coordinate={toLatLng(link.cell)}
      anchor={{ x: 0.5, y: 0.5 }}
      tracksViewChanges={false}
      zIndex={link.phase === 'current' ? 4 : link.phase === 'passed' ? 2 : 1}
      title={
        link.phase === 'current'
          ? `the ${link.name} tower — burning now`
          : link.phase === 'passed'
            ? `the ${link.name} tower — lit`
            : `the ${link.name} tower`
      }
    >
      <View style={{ alignItems: 'center', justifyContent: 'center', opacity }}>
        <View
          style={{
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: colour,
            // Only the blazing link gets a ring — the halo that makes it the
            // loudest thing on the panel, in place of the ember that used to
            // drift here.
            borderWidth: link.phase === 'current' ? Math.max(2, size / 4) : 0,
            borderColor: sky.chainCurrentRing,
          }}
        />
      </View>
    </Marker>
  );
}

/** The whole chain, drawn in order. */
export function NightChain({ links, zoom }: { links: readonly ChainLink[]; zoom: number | null }) {
  return (
    <>
      {links.map((link) => (
        <TowerFlame key={link.cell} link={link} zoom={zoom} />
      ))}
    </>
  );
}

function toLatLng(cell: CellId): { latitude: number; longitude: number } {
  const point = displayPoint(cell);
  return { latitude: point.lat, longitude: point.lng };
}

export { chainFor };
export type { ChainLink };
