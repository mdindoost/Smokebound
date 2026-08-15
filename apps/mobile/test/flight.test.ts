/**
 * Client-side flight interpolation (ARCHITECTURE §2: cosmetic only).
 *
 * The rule this suite is really protecting: the client never decides anything.
 * It reads the server's segment ETAs and puts a dot somewhere sensible — and
 * when the server and the clock disagree, it defers to the server.
 */

import { cellCenter, cellId, haversineKm } from '@smoke/shared';
import { describe, expect, it } from 'vitest';

import { flightAt, pathOf, regionFor } from '../src/lib/flight';
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
  it('turns cells into a path', () => {
    expect(pathOf(ROUTE)).toHaveLength(ROUTE.length);
    expect(pathOf(ROUTE)[0]).toEqual(cellCenter(NEWARK));
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
