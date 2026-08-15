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

import { StyleSheet, View } from 'react-native';
import MapView, { UrlTile } from 'react-native-maps';
import type { MapViewProps, Region } from 'react-native-maps';
import type { ReactNode } from 'react';

import { RADAR_ATTRIBUTION, RADAR_OPACITY, RADAR_TILE_URL, darkMapStyle, sky } from '../design/sky';
import { Caption } from '../design/components';
import { radii, spacing } from '../design/tokens';

export interface SkyPanelProps extends Omit<MapViewProps, 'style'> {
  region: Region;
  /** NWS precipitation tiles (ARCHITECTURE §1). */
  radar?: boolean;
  height?: number;
  rounded?: boolean;
  children?: ReactNode;
}

export function SkyPanel({
  region,
  radar = false,
  height = 320,
  rounded = true,
  children,
  ...props
}: SkyPanelProps) {
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
        style={StyleSheet.absoluteFill}
        initialRegion={region}
        customMapStyle={darkMapStyle as unknown as MapViewProps['customMapStyle']}
        mapType="mutedStandard"
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
          <UrlTile
            urlTemplate={RADAR_TILE_URL}
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
