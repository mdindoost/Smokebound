/**
 * Where the smoke is, right now (ARCHITECTURE §2).
 *
 * "Position between waypoints is interpolated client-side from `segment_etas`
 * for smooth animation — **cosmetic only**." Everything here is derived from
 * server truth and decides nothing: the engine owns state, legs, ETAs and
 * delivery. If this file disagrees with the server, the server is right and the
 * dot is in the wrong place for a few seconds.
 */

import { cellCenter, interpolateGreatCircle } from '@smoke/shared';
import type { CellId, LatLng } from '@smoke/shared';

export interface SegmentEta {
  leg: number;
  cell: CellId;
  cumulative_hours: number;
  eta: string;
}

export interface FlightSnapshot {
  /** Where to draw the smoke, or null when there is nothing in the air. */
  position: LatLng | null;
  /** The waypoint it has last passed. */
  leg: number;
  /** 0–1 along the whole route. */
  progress: number;
  /** Cells already flown, including the one it is leaving. */
  flown: CellId[];
  /** Cells still to come. */
  ahead: CellId[];
  /** True while it is still puffing at the origin (MECHANICS §3). */
  transmitting: boolean;
  arrived: boolean;
}

export interface FlightInput {
  state: string;
  route: CellId[] | null;
  segmentEtas: SegmentEta[] | null;
  departedAt: string | null;
  eta: string | null;
  strandedCell: CellId | null;
  lostCell: CellId | null;
}

const at = (iso: string | null): number => (iso === null ? NaN : new Date(iso).getTime());

/**
 * Interpolate along the great circle between the two waypoints the message is
 * currently between. Between-waypoint motion is a straight line on the map at
 * this zoom either way; the great circle keeps it consistent with the router.
 */
export function flightAt(input: FlightInput, now: Date): FlightSnapshot {
  const route = input.route ?? [];
  const segments = input.segmentEtas ?? [];

  const empty: FlightSnapshot = {
    position: null,
    leg: 0,
    progress: 0,
    flown: [],
    ahead: route,
    transmitting: false,
    arrived: false,
  };

  if (route.length === 0) return empty;

  // Terminal states sit where they stopped.
  if (input.state === 'LOST') {
    const cell = input.lostCell ?? route[0]!;
    return { ...empty, position: cellCenter(cell), flown: [cell], ahead: [] };
  }
  if (input.state === 'DELIVERED') {
    const last = route[route.length - 1]!;
    return {
      position: cellCenter(last),
      leg: Math.max(0, route.length - 1),
      progress: 1,
      flown: route,
      ahead: [],
      transmitting: false,
      arrived: true,
    };
  }
  if (input.state === 'STRANDED') {
    const cell = input.strandedCell ?? route[0]!;
    const index = Math.max(0, route.indexOf(cell));
    return {
      position: cellCenter(cell),
      leg: index,
      progress: route.length > 1 ? index / (route.length - 1) : 0,
      flown: route.slice(0, index + 1),
      ahead: route.slice(index),
      transmitting: false,
      arrived: false,
    };
  }

  const departed = at(input.departedAt);
  if (Number.isNaN(departed) || now.getTime() < departed) {
    // Still puffing at the origin — the fire is lit, nothing has left yet.
    return { ...empty, position: cellCenter(route[0]!), transmitting: true, ahead: route };
  }

  if (segments.length < 2) {
    return { ...empty, position: cellCenter(route[0]!), ahead: route };
  }

  const time = now.getTime();
  const last = segments[segments.length - 1]!;
  if (time >= at(last.eta)) {
    // Past its ETA but not yet marked delivered: the cron runs every minute, and
    // showing it parked at the destination beats showing it in the wrong place.
    return {
      position: cellCenter(last.cell),
      leg: last.leg,
      progress: 1,
      flown: route,
      ahead: [],
      transmitting: false,
      arrived: false,
    };
  }

  let index = 0;
  for (let i = 0; i < segments.length - 1; i++) {
    if (time >= at(segments[i + 1]!.eta)) index = i + 1;
    else break;
  }

  const from = segments[index]!;
  const to = segments[index + 1] ?? from;
  const span = at(to.eta) - at(from.eta);
  const fraction = span > 0 ? Math.min(1, Math.max(0, (time - at(from.eta)) / span)) : 0;

  const position = interpolateGreatCircle(cellCenter(from.cell), cellCenter(to.cell), fraction);
  const totalSpan = at(last.eta) - at(segments[0]!.eta);
  const progress = totalSpan > 0 ? Math.min(1, Math.max(0, (time - at(segments[0]!.eta)) / totalSpan)) : 0;

  return {
    position,
    leg: from.leg,
    progress,
    flown: route.slice(0, from.leg + 1),
    ahead: route.slice(from.leg),
    transmitting: false,
    arrived: false,
  };
}

/** Map cells to coordinates for a polyline. */
export function pathOf(cells: readonly CellId[]): LatLng[] {
  return cells.map((cell) => cellCenter(cell));
}

/** A region that frames a route with a little air around it. */
export function regionFor(cells: readonly CellId[], padding = 1.4): {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
} {
  const points = pathOf(cells);
  if (points.length === 0) {
    // The middle of the launch region, zoomed out: better than a blank ocean.
    return { latitude: 39.5, longitude: -96, latitudeDelta: 30, longitudeDelta: 50 };
  }

  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);

  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLng + maxLng) / 2,
    latitudeDelta: Math.max(0.6, (maxLat - minLat) * padding),
    longitudeDelta: Math.max(0.6, (maxLng - minLng) * padding),
  };
}
