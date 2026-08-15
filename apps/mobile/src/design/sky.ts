/**
 * The sky panel (DESIGN.md V1, V2).
 *
 * V1: the map is a **dark panel inset in a parchment app**, not a dark theme.
 * These tokens are a sub-palette used inside the map surface only; the chrome
 * around it stays parchment. Every token has a parchment counterpart by role
 * (`ground`, `raised`, `line`, `text`, `textFaint`), so a future full dark mode
 * is a swap of the semantic layer rather than a rewrite.
 *
 * V2: weather keeps its own hues but enters the system desaturated and under a
 * fixed opacity ceiling. Nothing on the map may use radar's colours, and the
 * loudest thing on any screen stays the smoke.
 */

import { palette } from './tokens';

export const sky = {
  ground: '#131A21',
  raised: '#1D2831',
  line: '#2C3B47',
  text: '#E8E1D4',
  textFaint: '#8FA0AE',
  land: '#1A232B',
  water: '#0E141A',

  /** The smoke itself: the one thing allowed to glow. */
  trail: palette.emberBright,
  trailGlow: palette.emberGlow,
  /** The part of the route not yet flown. */
  ahead: '#4A5C6B',
  /** Where the smoke is sheltering (V4: calm, not alarming). */
  sheltering: palette.storm,
  /** Where a message died. */
  lost: palette.ash,
  /** A tower mark. */
  tower: '#C7B79A',
  /** A cell whose weather we are guessing (MECHANICS §2.1 fail-open). */
  unknown: '#6E7C88',
  /** A storm the route steered around. */
  storm: '#7C8894',

  /** Translucent fills. Screens never spell an rgba() of their own. */
  smokeHalo: 'rgba(246,200,138,0.25)',
  shelterHalo: 'rgba(93,104,115,0.28)',
  stormFill: 'rgba(124,136,148,0.40)',
  panelScrim: 'rgba(19,26,33,0.72)',
} as const;

/** V2: the radar's ceiling. Tiles sit under the route, never over it. */
export const RADAR_OPACITY = 0.55;

/**
 * A dark map style for the Google provider. Deliberately quiet: this is a
 * night-time chart, not a road map — no business labels, no highway shields,
 * just land, water and enough coastline to know where you are.
 *
 * (Apple Maps has no style API; on iOS the panel relies on `mapType="mutedStandard"`
 * plus the overlay. See DESIGN.md and the note in `SkyPanel`.)
 */
export const darkMapStyle = [
  { elementType: 'geometry', stylers: [{ color: sky.land }] },
  { elementType: 'labels.text.fill', stylers: [{ color: sky.textFaint }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: sky.ground }] },
  { featureType: 'administrative', elementType: 'geometry', stylers: [{ color: sky.line }] },
  { featureType: 'administrative.land_parcel', stylers: [{ visibility: 'off' }] },
  { featureType: 'administrative.neighborhood', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: sky.raised }] },
  { featureType: 'road', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: sky.water }] },
  { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: sky.line }] },
] as const;

/**
 * NWS precipitation imagery (ARCHITECTURE §1, §7.1).
 *
 * The CONUS base-reflectivity mosaic, served as WMS by NOAA/NCEP's GeoServer.
 * Free, keyless, and the same product the forecast pages draw.
 *
 * This was an ArcGIS `/tile/{z}/{y}/{x}` URL until it was tested against the
 * live service and every request came back 404. Two things were wrong, and the
 * second is why the first could not simply be patched: the `_time` endpoint is
 * an ImageServer rather than a MapServer, and its sibling MapServer reports
 * `singleFusedMapCache: false` — it has no tile cache at all, so no XYZ-shaped
 * URL was ever going to work. WMS asks for a bbox instead of a tile index, so
 * it needs no cache. Verified: 200 image/png, with returns over ~5% of CONUS.
 *
 * The placeholders are filled in by react-native-maps' <WMSTile>. Bounds arrive
 * in EPSG:3857, which the service advertises, so the imagery lands square on a
 * web-mercator map with no reprojection.
 */
export const RADAR_WMS_URL =
  'https://opengeo.ncep.noaa.gov/geoserver/conus/conus_bref_qcd/ows' +
  '?service=WMS&version=1.1.1&request=GetMap&layers=conus_bref_qcd' +
  '&bbox={minX},{minY},{maxX},{maxY}&width={width}&height={height}' +
  '&srs=EPSG:3857&format=image/png&transparent=true';

export const RADAR_ATTRIBUTION = 'Radar: NOAA / National Weather Service';
