/**
 * Client-side flight interpolation (ARCHITECTURE §2: cosmetic only).
 *
 * The rule this suite is really protecting: the client never decides anything.
 * It reads the server's segment ETAs and puts a dot somewhere sensible — and
 * when the server and the clock disagree, it defers to the server.
 */

import { cellCenter, cellId, haversineKm } from '@smoke/shared';
import { describe, expect, it } from 'vitest';

import { confirmedCells, flightAt, pathOf, regionFor } from '../src/lib/flight';
import type { FlightInput, SegmentEta } from '../src/lib/flight';

const NEWARK = cellId({ lat: 40.7357, lng: -74.1724 });
const CHICAGO = cellId({ lat: 41.8781, lng: -87.6298 });

const DEPARTED = new Date('2026-08-14T12:00:00.000Z');
const HOURS = 36;

/** A four-cell route with evenly spaced ETAs. */
const ROUTE = [NEWARK, 'r038c085', 'r038c078', CHICAGO];
const SEGMENTS: SegmentEta[] = ROUTE.map((cell, leg) => ({
  leg,
  cell,
  cumulative_hours: (HOURS / 3) * leg,
  eta: new Date(DEPARTED.getTime() + ((HOURS / 3) * leg) * 3_600_000).toISOString(),
}));

function input(patch: Partial<FlightInput> = {}): FlightInput {
  return {
    state: 'IN_FLIGHT',
    route: ROUTE,
    segmentEtas: SEGMENTS,
    departedAt: DEPARTED.toISOString(),
    eta: SEGMENTS[SEGMENTS.length - 1]!.eta,
    strandedCell: null,
    lostCell: null,
    ...patch,
  };
}

const at = (hoursAfterDeparture: number): Date =>
  new Date(DEPARTED.getTime() + hoursAfterDeparture * 3_600_000);

describe('flightAt', () => {
  it('sits at the origin while the fire is still puffing', () => {
    const snapshot = flightAt(
      input({ state: 'TRANSMITTING', departedAt: at(0.5).toISOString() }),
      DEPARTED,
    );
    expect(snapshot.transmitting).toBe(true);
    expect(snapshot.position).toEqual(cellCenter(NEWARK));
    expect(snapshot.progress).toBe(0);
    expect(snapshot.ahead).toEqual(ROUTE);
  });

  it('leaves the origin the moment it departs', () => {
    const snapshot = flightAt(input(), DEPARTED);
    expect(snapshot.transmitting).toBe(false);
    expect(snapshot.leg).toBe(0);
    // Interpolated at f = 0, so it lands on the origin to within a metre.
    expect(haversineKm(snapshot.position!, cellCenter(NEWARK))).toBeLessThan(0.001);
  });

  it('moves between waypoints, not in jumps', () => {
    const sixth = flightAt(input(), at(HOURS / 6)).position!;
    const start = cellCenter(ROUTE[0]!);
    const firstWaypoint = cellCenter(ROUTE[1]!);

    // Half way through the first leg: between the two, and close to the middle.
    const toStart = haversineKm(sixth, start);
    const toNext = haversineKm(sixth, firstWaypoint);
    expect(toStart).toBeGreaterThan(1);
    expect(toNext).toBeGreaterThan(1);
    expect(Math.abs(toStart - toNext)).toBeLessThan(5);
  });

  it('advances the leg as waypoints pass', () => {
    expect(flightAt(input(), at(HOURS / 3 + 0.1)).leg).toBe(1);
    expect(flightAt(input(), at((2 * HOURS) / 3 + 0.1)).leg).toBe(2);
  });

  it('splits the route into flown and ahead', () => {
    const snapshot = flightAt(input(), at(HOURS / 3 + 0.1));
    expect(snapshot.flown).toEqual(ROUTE.slice(0, 2));
    expect(snapshot.ahead[0]).toBe(ROUTE[1]);
    expect(snapshot.ahead.at(-1)).toBe(CHICAGO);
  });

  it('reports progress monotonically', () => {
    let previous = -1;
    for (let hour = 0; hour <= HOURS; hour += 2) {
      const progress = flightAt(input(), at(hour)).progress;
      expect(progress).toBeGreaterThanOrEqual(previous);
      expect(progress).toBeLessThanOrEqual(1);
      previous = progress;
    }
  });

  it('parks at the destination past the ETA rather than guessing', () => {
    // The delivery cron runs every minute; for that minute the message is still
    // IN_FLIGHT with its ETA behind it. Show it arrived, not overshooting.
    const snapshot = flightAt(input(), at(HOURS + 1));
    expect(snapshot.position).toEqual(cellCenter(CHICAGO));
    expect(snapshot.progress).toBe(1);
    expect(snapshot.arrived).toBe(false); // the server has not said so yet
  });

  it('shows a delivered message at its destination', () => {
    const snapshot = flightAt(input({ state: 'DELIVERED' }), at(HOURS + 5));
    expect(snapshot.arrived).toBe(true);
    expect(snapshot.position).toEqual(cellCenter(CHICAGO));
    expect(snapshot.ahead).toEqual([]);
  });

  it('shows a stranded message waiting where it stopped', () => {
    const snapshot = flightAt(
      input({ state: 'STRANDED', strandedCell: ROUTE[1]! }),
      at(HOURS * 2),
    );
    expect(snapshot.position).toEqual(cellCenter(ROUTE[1]!));
    expect(snapshot.leg).toBe(1);
    expect(snapshot.flown).toEqual(ROUTE.slice(0, 2));
    expect(snapshot.ahead[0]).toBe(ROUTE[1]);
  });

  it('shows a lost message where it died', () => {
    const snapshot = flightAt(
      input({ state: 'LOST', lostCell: ROUTE[2]! }),
      at(HOURS * 3),
    );
    expect(snapshot.position).toEqual(cellCenter(ROUTE[2]!));
    expect(snapshot.ahead).toEqual([]);
  });

  it('copes with a message that has no route at all (REDTEAM F17)', () => {
    const snapshot = flightAt(
      input({ route: null, segmentEtas: null, eta: null }),
      DEPARTED,
    );
    expect(snapshot.position).toBeNull();
    expect(snapshot.flown).toEqual([]);
  });

  it('copes with a one-cell route', () => {
    const snapshot = flightAt(
      input({ route: [NEWARK], segmentEtas: [SEGMENTS[0]!] }),
      at(1),
    );
    expect(snapshot.position).toEqual(cellCenter(NEWARK));
  });
});

describe('map geometry', () => {
  it('turns cells into a path, drawn on towns rather than centroids', () => {
    expect(pathOf(ROUTE)).toHaveLength(ROUTE.length);

    // The endpoint is the town the cell is named after, not the arithmetic
    // centre — a centre that, for the cell covering Little Falls NJ, sits in the
    // Cedar Grove Reservoir. It stays inside its own cell either way.
    const first = pathOf(ROUTE)[0]!;
    expect(cellId(first)).toBe(NEWARK);
    expect(haversineKm(first, cellCenter(NEWARK))).toBeLessThan(40);
  });

  it('never lets the drawn path change a quoted distance', () => {
    // Drawing moved; measuring must not. The engine and every number on screen
    // measure centre to centre.
    const drawn = pathOf(ROUTE);
    const quoted = haversineKm(cellCenter(ROUTE[0]!), cellCenter(ROUTE[ROUTE.length - 1]!));
    const painted = haversineKm(drawn[0]!, drawn[drawn.length - 1]!);
    expect(Math.abs(painted - quoted)).toBeLessThan(40);
  });

  it('frames a route with air around it', () => {
    const region = regionFor(ROUTE);
    const lats = pathOf(ROUTE).map((p) => p.lat);
    const lngs = pathOf(ROUTE).map((p) => p.lng);

    expect(region.latitude).toBeGreaterThan(Math.min(...lats) - 1);
    expect(region.latitude).toBeLessThan(Math.max(...lats) + 1);
    expect(region.longitudeDelta).toBeGreaterThan(Math.max(...lngs) - Math.min(...lngs));
  });

  it('falls back to the whole launch region when there is nothing to frame', () => {
    const region = regionFor([]);
    expect(region.latitudeDelta).toBeGreaterThan(10);
  });

  it('gives a single cell a usable zoom rather than an infinite one', () => {
    const region = regionFor([NEWARK]);
    expect(region.latitudeDelta).toBeGreaterThan(0);
    expect(region.longitudeDelta).toBeGreaterThan(0);
  });
});

describe('not claiming what the engine has not said', () => {
  // The bug: with the engine stopped for 90 minutes, the flight screen showed
  // "Progress 100%", drew the whole route in ember, and listed both towers as
  // passed — while the only authority in the system still said IN_FLIGHT with
  // delivered_at null. Interpolation is allowed to run ahead. Narration is not.

  const ROUTE_2 = ['r037c090', 'r036c090'];
  const SEGMENTS: SegmentEta[] = [
    { leg: 0, cell: 'r037c090', cumulative_hours: 0, eta: '2026-08-15T02:11:00.000Z' },
    { leg: 1, cell: 'r036c090', cumulative_hours: 1.5, eta: '2026-08-15T03:40:00.000Z' },
  ];
  const base: FlightInput = {
    state: 'IN_FLIGHT',
    route: ROUTE_2,
    segmentEtas: SEGMENTS,
    departedAt: '2026-08-15T02:11:00.000Z',
    eta: '2026-08-15T03:40:00.000Z',
    strandedCell: null,
    lostCell: null,
  };

  it('flags a flight past its ETA that the engine has not confirmed', () => {
    const snapshot = flightAt(base, new Date('2026-08-15T03:42:00.000Z'));
    expect(snapshot.awaitingConfirmation).toBe(true);
    expect(snapshot.arrived).toBe(false);
  });

  it('does not flag a flight still genuinely in the air', () => {
    const snapshot = flightAt(base, new Date('2026-08-15T03:00:00.000Z'));
    expect(snapshot.awaitingConfirmation).toBe(false);
    expect(snapshot.progress).toBeLessThan(1);
  });

  it('does not flag a delivered flight — that one really did arrive', () => {
    const snapshot = flightAt(
      { ...base, state: 'DELIVERED' },
      new Date('2026-08-15T03:42:00.000Z'),
    );
    expect(snapshot.awaitingConfirmation).toBe(false);
    expect(snapshot.arrived).toBe(true);
  });

  it('confirms only the legs the engine has committed to', () => {
    // Interpolation says both cells are behind us; current_leg says otherwise.
    const snapshot = flightAt(base, new Date('2026-08-15T03:42:00.000Z'));
    expect(snapshot.flown).toEqual(ROUTE_2);
    expect(confirmedCells(ROUTE_2, 0, 'IN_FLIGHT', base.departedAt)).toEqual(['r037c090']);
  });

  it('confirms the whole route once delivered', () => {
    expect(confirmedCells(ROUTE_2, 0, 'DELIVERED', base.departedAt)).toEqual(ROUTE_2);
  });

  it('confirms nothing before the smoke has left', () => {
    expect(confirmedCells(ROUTE_2, null, 'TRANSMITTING', null)).toEqual([]);
  });
});
