/**
 * The sky panel (DESIGN.md V1): a dark map inset in a parchment app.
 *
 * Deliberately a *panel*, not a screen background — the chrome around it stays
 * parchment, and the darkness is the window rather than the theme. Everything
 * drawn inside uses the `sky` sub-palette.
 *
 * Provider: the default (Apple Maps on iOS, Google on Android), which is what
 * Expo Go supports without a custom dev client. Google honours `customMapStyle`;
 * Apple has no style API, so on iOS the darkness comes from `mutedStandard` plus
 * the panel's own scrim. Noted in DESIGN.md as a place the two platforms differ
 * more than we would like.
 */

import { useEffect, useRef } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import MapView, { WMSTile } from 'react-native-maps';
import type { MapViewProps, Region } from 'react-native-maps';
import type { ReactNode } from 'react';
import type { LatLng } from '@smoke/shared';

import { RADAR_ATTRIBUTION, RADAR_OPACITY, RADAR_WMS_URL, darkMapStyle, sky } from '../design/sky';
import { Caption } from '../design/components';
import { radii, spacing } from '../design/tokens';

export interface SkyPanelProps extends Omit<MapViewProps, 'style'> {
  region: Region;
  /** NWS precipitation tiles (ARCHITECTURE §1). */
  radar?: boolean;
  /**
   * A stable description of *what* the region frames — the route, the set of
   * signals in the air. The camera re-frames when this changes and stays put
   * when it does not, so a poll that returns the same flight never steals the
   * map back from someone who panned it. Omit to leave the camera alone.
   */
  regionKey?: string;
  /**
   * Coordinates the panel must show in full.
   *
   * Preferred over `region` wherever the thing being framed is a route.
   * `region` is a centre plus a span, and a span computed from a bounding box
   * does not account for the panel's aspect ratio or for the marks that hang
   * off the line — tower triangles, the smoke's halo, the radar attribution bar
   * along the bottom. `fitToCoordinates` takes explicit edge padding in points
   * and is the only way to promise the route is never clipped.
   */
  fitTo?: readonly LatLng[];
  /** Reported after any camera move, so callers can gate detail on zoom. */
  onZoomChange?: (longitudeDelta: number) => void;
  height?: number;
  rounded?: boolean;
  children?: ReactNode;
}

export function SkyPanel({
  region,
  radar = false,
  regionKey,
  fitTo,
  onZoomChange,
  height = 320,
  rounded = true,
  children,
  ...props
}: SkyPanelProps) {
  const map = useRef<MapView | null>(null);

  // Re-frame only when what we are framing actually changes — a new signal, a
  // delivery, a reroute. Animating on every poll would yank the map out from
  // under anyone who had panned it to look at the weather.
  useEffect(() => {
    if (regionKey === undefined) return;

    // Fit the actual geometry where we have it. Room is left along the bottom
    // for the radar attribution bar, which otherwise sits on top of whatever
    // the route does in its last few miles.
    if (fitTo !== undefined && fitTo.length > 1) {
      map.current?.fitToCoordinates(
        fitTo.map((point) => ({ latitude: point.lat, longitude: point.lng })),
        {
          edgePadding: { top: 44, right: 44, bottom: 72, left: 44 },
          animated: true,
        },
      );
      return;
    }

    map.current?.animateToRegion(
      {
        latitude: region.latitude,
        longitude: region.longitude,
        latitudeDelta: region.latitudeDelta,
        longitudeDelta: region.longitudeDelta,
      },
      600,
    );
  }, [regionKey]);

  return (
    <View
      style={{
        height,
        borderRadius: rounded ? radii.lg : 0,
        overflow: 'hidden',
        backgroundColor: sky.ground,
        borderWidth: rounded ? StyleSheet.hairlineWidth : 0,
        borderColor: sky.line,
      }}
    >
      <MapView
        {...props}
        ref={map}
        style={StyleSheet.absoluteFill}
        initialRegion={region}
        onRegionChangeComplete={(next) => onZoomChange?.(next.longitudeDelta)}
        // The two halves of DESIGN.md V1, one per platform. `customMapStyle` is
        // a Google Maps feature and Apple Maps ignores it in silence, which is
        // why the panel shipped stock-light on iOS: the style was never refused,
        // it was never read. `userInterfaceStyle` is the Apple Maps equivalent
        // and is itself a no-op on Android. Both are needed; neither is enough.
        customMapStyle={darkMapStyle as unknown as MapViewProps['customMapStyle']}
        userInterfaceStyle="dark"
        mapType={Platform.OS === 'ios' ? 'mutedStandard' : 'standard'}
        showsPointsOfInterest={false}
        showsTraffic={false}
        showsBuildings={false}
        showsCompass={false}
        toolbarEnabled={false}
        rotateEnabled={false}
        pitchEnabled={false}
      >
        {radar && (
          // V2: radar keeps its own hues but sits under everything, dimmed.
          <WMSTile
            urlTemplate={RADAR_WMS_URL}
            zIndex={-1}
            opacity={RADAR_OPACITY}
            maximumZ={12}
            tileSize={256}
          />
        )}
        {children}
      </MapView>

      {radar && (
        <View
          style={{
            position: 'absolute',
            left: spacing.sm,
            bottom: spacing.sm,
            backgroundColor: sky.panelScrim,
            paddingHorizontal: spacing.sm,
            paddingVertical: 2,
            borderRadius: radii.sm,
          }}
        >
          <Caption style={{ color: sky.textFaint }}>{RADAR_ATTRIBUTION}</Caption>
        </View>
      )}
    </View>
  );
}
