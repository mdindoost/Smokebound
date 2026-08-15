/**
 * What a flight looks like on the panel.
 *
 * The route is drawn twice: the part already flown in ember, the part still to
 * come in a cool grey. The smoke itself is the only glowing thing on the map
 * (DESIGN.md V2) — if anything else here starts glowing, that is the bug.
 *
 * Towers are cosmetic marks at the waypoints (SPEC §3 v1.1). Cells whose
 * weather we are guessing get a small hollow ring, so a route drawn on
 * fail-open data does not pretend to be observed (MECHANICS §2.1).
 */

import { Marker, Polyline } from 'react-native-maps';
import { View } from 'react-native';
// Two kinds of point, deliberately. A fire or a tower stands in a *town*, so it
// draws on the town. Weather belongs to the whole 50 km cell and has no address,
// so it draws on the centre — moving a storm onto a townsite would claim a
// precision the forecast does not have.
import { cellCenter, displayPoint } from '@smoke/shared';
import type { CellId, LatLng } from '@smoke/shared';

import { sky } from '../design/sky';
import type { Regime } from './NightLayer';
import { pathOf } from '../lib/flight';
import type { FlightSnapshot } from '../lib/flight';

export function RouteLine({
  flown,
  ahead,
  dimmed = false,
}: {
  flown: readonly CellId[];
  ahead: readonly CellId[];
  dimmed?: boolean;
}) {
  return (
    <>
      {ahead.length > 1 && (
        <Polyline
          coordinates={pathOf(ahead).map(toLatLng)}
          strokeColor={sky.ahead}
          strokeWidth={2}
          lineDashPattern={[6, 6]}
        />
      )}
      {flown.length > 1 && (
        <Polyline
          coordinates={pathOf(flown).map(toLatLng)}
          strokeColor={dimmed ? sky.ahead : sky.trail}
          strokeWidth={3}
        />
      )}
    </>
  );
}

/**
 * The smoke: a soft ember disc where the message is right now — or, after dark,
 * a fire (MECHANICS-V2 §1.3, REDTEAM F32).
 *
 * `regime` is theater. It says what the tower is burning, and it is drawn from
 * the same sun function the router prices hops with, so the map and the model
 * can never disagree about whether it is night here.
 */
export function SmokeMarker({
  snapshot,
  state,
  regime = 'smoke',
  onPress,
}: {
  snapshot: FlightSnapshot;
  state: string;
  regime?: Regime;
  onPress?: () => void;
}) {
  if (snapshot.position === null) return null;

  const colour =
    state === 'STRANDED'
      ? sky.sheltering
      : state === 'LOST'
        ? sky.lost
        : state === 'DELIVERED'
          ? sky.trail
          : sky.trailGlow;

  return (
    <Marker
      coordinate={toLatLng(snapshot.position)}
      anchor={{ x: 0.5, y: 0.5 }}
      tracksViewChanges={false}
      zIndex={3}
      onPress={onPress}
    >
      <View
        style={{
          // Smoke is a shape: a soft wide column, its edges indistinct.
          // Fire is a point: a small hot centre throwing light much further than
          // its own size. Two different marks, not one mark at two diameters —
          // the first attempt changed only the width, by four points, and was
          // correctly reported from a real phone at 2:56 AM as still being the
          // daytime ember.
          width: regime === 'fire' ? 34 : 26,
          height: regime === 'fire' ? 34 : 26,
          borderRadius: 17,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor:
            state === 'STRANDED'
              ? sky.shelterHalo
              : regime === 'fire'
                ? sky.fireHalo
                : sky.smokeHalo,
        }}
      >
        <View
          style={{
            // The fire's core is small and near-white — the hottest thing on the
            // map, and the only place that colour appears.
            width: regime === 'fire' ? 8 : 12,
            height: regime === 'fire' ? 8 : 12,
            borderRadius: 6,
            backgroundColor:
              regime === 'fire' && state !== 'STRANDED' && state !== 'LOST'
                ? sky.fireCore
                : colour,
            borderWidth: regime === 'fire' ? 3 : 1,
            borderColor:
              regime === 'fire' && state !== 'STRANDED' && state !== 'LOST'
                ? sky.fireGlow
                : sky.ground,
          }}
        />
      </View>
    </Marker>
  );
}

/**
 * A beacon tower: a squat trapezoid with a light on top. Cosmetic only.
 *
 * `lit` is the night state (M5.6). A tower stands unlit by day and burns after
 * dark, which is the same distinction the smoke marker makes and for the same
 * reason: the map should describe the world the message is crossing, not only
 * the message.
 *
 * Drawn on the town rather than the cell centroid, and sized to be findable —
 * the first pass was 8pt wide, smaller than the smoke's inner ember, and the
 * destination tower vanished underneath the smoke at the exact moment of
 * arrival. It sits below the smoke in z-order for the same reason: when the two
 * do overlap, the fire is the thing you came to see.
 */
export function TowerMark({
  cell,
  name,
  lit = false,
  passed = false,
}: {
  cell: CellId;
  name: string;
  lit?: boolean;
  /** The smoke is already past this one. Behind reads brighter than ahead. */
  passed?: boolean;
}) {
  return (
    <Marker
      coordinate={toLatLng(displayPoint(cell))}
      anchor={{ x: 0.5, y: 1 }}
      tracksViewChanges={false}
      zIndex={1}
      title={`the ${name} tower`}
    >
      {/* Towers behind the smoke are part of the story and read brighter; ones
          still ahead are faint, so the eye follows the ember rather than
          counting fenceposts. */}
      <View style={{ alignItems: 'center', opacity: passed ? 0.95 : 0.45 }}>
        <View
          style={{
            width: 4,
            height: 4,
            borderRadius: 2,
            // Lit towers carry a warm lamp; unlit ones are stone. Still never
            // `trailGlow` — a landmark may be visible without competing with the
            // signal it exists to frame (DESIGN.md V2).
            backgroundColor: lit ? sky.tower : sky.towerLight,
            opacity: lit ? 1 : 0.7,
            marginBottom: 1,
          }}
        />
        <View
          style={{
            width: 0,
            height: 0,
            borderLeftWidth: 5,
            borderRightWidth: 5,
            borderBottomWidth: 9,
            borderLeftColor: 'transparent',
            borderRightColor: 'transparent',
            borderBottomColor: sky.tower,
          }}
        />
      </View>
    </Marker>
  );
}

/** A cell we are guessing about: hollow, faint, easy to miss and easy to find. */
export function UnknownWeatherMark({ cell }: { cell: CellId }) {
  return (
    <Marker
      coordinate={toLatLng(cellCenter(cell))}
      anchor={{ x: 0.5, y: 0.5 }}
      tracksViewChanges={false}
      zIndex={0}
      title="weather unknown here"
    >
      <View
        style={{
          width: 14,
          height: 14,
          borderRadius: 7,
          borderWidth: 1,
          borderColor: sky.unknown,
          borderStyle: 'dashed',
        }}
      />
    </Marker>
  );
}

/** A storm the route steered around (ARCHITECTURE §6.4 storms_avoided). */
export function StormMark({ cell }: { cell: CellId }) {
  return (
    <Marker
      coordinate={toLatLng(cellCenter(cell))}
      anchor={{ x: 0.5, y: 0.5 }}
      tracksViewChanges={false}
      zIndex={0}
      title="storm"
    >
      <View
        style={{
          width: 16,
          height: 16,
          borderRadius: 8,
          backgroundColor: sky.stormFill,
          borderWidth: 1,
          borderColor: sky.storm,
        }}
      />
    </Marker>
  );
}

const toLatLng = (point: { lat: number; lng: number }): { latitude: number; longitude: number } => ({
  latitude: point.lat,
  longitude: point.lng,
});

export { toLatLng };

/**
 * The day/night boundary, drawn as a soft line across the panel (M5.6).
 *
 * Deliberately quiet: dashed, cool, and beneath everything. It is context, not a
 * signal — the map's job here is to let someone see *why* the smoke behaves
 * differently on one side of it, without competing with the smoke itself.
 */
export function TerminatorLine({ points }: { points: readonly LatLng[] }) {
  if (points.length < 2) return null;
  return (
    <Polyline
      coordinates={points.map(toLatLng)}
      strokeColor={sky.terminator}
      strokeWidth={1}
      lineDashPattern={[3, 5]}
      zIndex={0}
    />
  );
}
