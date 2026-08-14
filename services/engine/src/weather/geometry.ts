/**
 * Point-in-polygon for matching NWS alert geometry to cells (REDTEAM F19).
 *
 * Alerts are fetched in bulk and matched locally, so this runs once per cell per
 * pass over a handful of storm polygons. Planar even-odd is accurate enough at
 * CONUS latitudes for polygons that are themselves drawn on a plane by the
 * forecaster, and it costs nothing.
 */

import type { LatLng } from '@smoke/shared';

import type { AlertGeometry } from './nws.js';

type Ring = number[][];

function ringsOf(geometry: AlertGeometry): Ring[] {
  if (geometry.type === 'Polygon') return geometry.coordinates as Ring[];
  return (geometry.coordinates as Ring[][]).flat();
}

function inRing(ring: Ring, lat: number, lng: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i] as [number, number];
    const [xj, yj] = ring[j] as [number, number];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/** True if the point falls inside the alert's polygon (holes handled even-odd). */
export function pointInAlert(geometry: AlertGeometry | null | undefined, point: LatLng): boolean {
  if (!geometry) return false;
  let inside = false;
  for (const ring of ringsOf(geometry)) {
    if (inRing(ring, point.lat, point.lng)) inside = !inside;
  }
  return inside;
}
