/**
 * Where the smoke is, right now (ARCHITECTURE §2).
 *
 * "Position between waypoints is interpolated client-side from `segment_etas`
 * for smooth animation — **cosmetic only**." Everything here is derived from
 * server truth and decides nothing: the engine owns state, legs, ETAs and
 * delivery. If this file disagrees with the server, the server is right and the
 * dot is in the wrong place for a few seconds.
 */

import { cellCenter, displayPoint, interpolateGreatCircle } from '@smoke/shared';
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
  /**
   * The smoke has reached the destination by our arithmetic, and the engine has
   * not said so yet.
   *
   * This is the gap the whole file lives in. Interpolation is cosmetic, so it
   * happily runs to the end of the route on a schedule the server may not have
   * caught up with — and if the engine is slow, or stopped, it stays there
   * looking finished. A screen that reads "100%" beside a state chip saying
   * IN FLIGHT is not a rounding artefact; it is the client claiming an outcome
   * it has no authority over. Callers must render this as waiting, not as done.
   */
  awaitingConfirmation: boolean;
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
    awaitingConfirmation: false,
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
      awaitingConfirmation: false,
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
      awaitingConfirmation: false,
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
    // Past its ETA but not yet marked delivered. Parking it at the destination
    // beats drawing it somewhere it is not — but the flag goes up, because the
    // difference between "arrived" and "should have arrived" belongs to the
    // engine, and it has not spoken. Normally this lasts under a minute
    // (routing.delivery_check_interval_minutes); if the engine is down it lasts
    // as long as the engine is down, and the screen should say so either way.
    return {
      position: cellCenter(last.cell),
      leg: last.leg,
      progress: 1,
      flown: route,
      ahead: [],
      transmitting: false,
      arrived: false,
      awaitingConfirmation: true,
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
    awaitingConfirmation: false,
  };
}

/**
 * The waypoints the *engine* has confirmed the smoke is past.
 *
 * `FlightSnapshot.flown` is interpolated and always at least as advanced; this
 * is the subset a timeline is allowed to state as fact. On a delivered message
 * that is the whole route; otherwise it is whatever `current_leg` says, and
 * nothing at all before departure.
 */
export function confirmedCells(
  route: readonly CellId[],
  currentLeg: number | null,
  state: string,
  departedAt: string | null,
): CellId[] {
  if (route.length === 0) return [];
  if (state === 'DELIVERED') return [...route];
  if (departedAt === null) return [];
  const leg = currentLeg ?? 0;
  return route.slice(0, Math.min(route.length, Math.max(0, leg) + 1));
}

/**
 * Map cells to coordinates for a polyline.
 *
 * Uses the town a cell is named after where one stands inside it, so a route
 * runs between places rather than between arithmetic centroids that can land in
 * reservoirs and bays. The shift is a kilometre or two and moves the drawn line
 * only — `haversineKm` on cell centres still owns every distance we quote.
 */
export function pathOf(cells: readonly CellId[]): LatLng[] {
  return cells.map((cell) => displayPoint(cell));
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
