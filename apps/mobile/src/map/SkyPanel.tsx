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
  height?: number;
  rounded?: boolean;
  children?: ReactNode;
}

export function SkyPanel({
  region,
  radar = false,
  regionKey,
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
