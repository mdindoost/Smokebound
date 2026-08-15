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
import type { CellId } from '@smoke/shared';

import { sky } from '../design/sky';
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

/** The smoke: a soft ember disc where the message is right now. */
export function SmokeMarker({
  snapshot,
  state,
  onPress,
}: {
  snapshot: FlightSnapshot;
  state: string;
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
          width: 26,
          height: 26,
          borderRadius: 13,
          alignItems: 'center',
          justifyContent: 'center',
          // The glow: a wide soft halo, then the ember itself.
          backgroundColor: state === 'STRANDED' ? sky.shelterHalo : sky.smokeHalo,
        }}
      >
        <View
          style={{
            width: 12,
            height: 12,
            borderRadius: 6,
            backgroundColor: colour,
            borderWidth: 1,
            borderColor: sky.ground,
          }}
        />
      </View>
    </Marker>
  );
}

/**
 * A beacon tower: a squat trapezoid with a light on top. Cosmetic only.
 *
 * Drawn on the town rather than the cell centroid, and sized to be findable —
 * the first pass was 8pt wide, smaller than the smoke's inner ember, and the
 * destination tower vanished underneath the smoke at the exact moment of
 * arrival. It sits below the smoke in z-order for the same reason: when the two
 * do overlap, the fire is the thing you came to see.
 */
export function TowerMark({ cell, name }: { cell: CellId; name: string }) {
  return (
    <Marker
      coordinate={toLatLng(displayPoint(cell))}
      anchor={{ x: 0.5, y: 1 }}
      tracksViewChanges={false}
      zIndex={1}
      title={`the ${name} tower`}
    >
      <View style={{ alignItems: 'center' }}>
        <View
          style={{
            width: 5,
            height: 5,
            borderRadius: 3,
            // Not `trailGlow`: a tower is a landmark, and only the smoke glows.
            backgroundColor: sky.towerLight,
            marginBottom: 1,
          }}
        />
        <View
          style={{
            width: 0,
            height: 0,
            borderLeftWidth: 7,
            borderRightWidth: 7,
            borderBottomWidth: 12,
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
