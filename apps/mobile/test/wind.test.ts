/**
 * The sky, said out loud.
 *
 * The rule these defend: what the flight view says about the wind must match
 * what the router charged for it. A screen reading "a following wind" beside an
 * ETA that slipped is worse than saying nothing.
 */

import { alongTrackWind, compassPoint, windRelation } from '@smoke/shared';
import { describe, expect, it } from 'vitest';

import { homeLine } from '../src/lib/copy';
import { routeWindSummary, windReading } from '../src/lib/wind';
import type { CellWeatherView } from '../src/lib/gateway';

const ROUTE = ['r037c090', 'r036c090'];

function weather(patch: Partial<CellWeatherView> & { cell: string }): CellWeatherView {
  return {
    condition: 'Clear',
    impassable: false,
    weatherUnknown: false,
    windMph: null,
    windDir: null,
    ...patch,
  };
}

const map = (...rows: CellWeatherView[]): Map<string, CellWeatherView> =>
  new Map(rows.map((row) => [row.cell, row]));

describe('wind geometry agrees with the router', () => {
  it('treats a wind blowing the way we travel as a tailwind', () => {
    // r037c090 is north of r036c090, so the smoke flies south (bearing 180).
    // A north wind (blowing *from* 0°) pushes it along.
    expect(alongTrackWind(20, 0, 180)).toBeCloseTo(20, 5);
    expect(windRelation(20, 0, 180)).toBe('tailwind');
  });

  it('treats a wind blowing against us as a headwind', () => {
    expect(alongTrackWind(20, 180, 180)).toBeCloseTo(-20, 5);
    expect(windRelation(20, 180, 180)).toBe('headwind');
  });

  it('calls a wind mostly across the track a crosswind', () => {
    expect(windRelation(20, 90, 180)).toBe('crosswind');
  });

  it('says nothing of a wind too light to feel', () => {
    expect(windRelation(1, 180, 180)).toBe('calm');
  });

  it('names directions the way a forecast does', () => {
    expect(compassPoint(0)).toBe('N');
    expect(compassPoint(225)).toBe('SW');
    expect(compassPoint(247)).toBe('WSW');
  });
});

describe('windReading', () => {
  it('describes the cell the smoke is in right now', () => {
    const reading = windReading(ROUTE, 0, map(weather({ cell: ROUTE[0]!, windMph: 12, windDir: 180 })));
    expect(reading?.line).toContain('12 mph S');
    expect(reading?.line).toContain('headwind');
    expect(reading?.adverse).toBe(true);
  });

  it('refuses to invent conditions for a cell we never fetched', () => {
    expect(windReading(ROUTE, 0, new Map())).toBeNull();
  });

  it('refuses to call an unforecast cell calm', () => {
    // Fail-open routing treats these as clear; the copy must not repeat that
    // guess back as an observation.
    const unknown = map(weather({ cell: ROUTE[0]!, weatherUnknown: true, windMph: 5, windDir: 90 }));
    expect(windReading(ROUTE, 0, unknown)).toBeNull();
  });
});

describe('routeWindSummary', () => {
  it('names the worst headwind rather than averaging the route', () => {
    const summary = routeWindSummary(
      ROUTE,
      map(weather({ cell: ROUTE[0]!, windMph: 25, windDir: 180 })),
    );
    expect(summary).toContain('Headwinds near Little Falls');
  });

  it('says so plainly when nothing is in the way', () => {
    const summary = routeWindSummary(
      ROUTE,
      map(weather({ cell: ROUTE[0]!, windMph: 4, windDir: 0 })),
    );
    expect(summary).toBe('Light winds along the route.');
  });

  it('stays quiet when it knows nothing', () => {
    expect(routeWindSummary(ROUTE, new Map())).toBeNull();
  });
});

describe('homeLine', () => {
  it('never shows a grid coordinate to a person', () => {
    expect(homeLine('r037c090')).toBe('fire near Little Falls');
    expect(homeLine('r037c090')).not.toMatch(/r\d+c\d+/);
  });

  it('is honest about ground it cannot name', () => {
    expect(homeLine(null)).toBe('fire not yet lit');
  });
});
