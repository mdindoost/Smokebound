/**
 * The border rule in action (MECHANICS §1.1, REDTEAM F16).
 *
 * NWS stops at the border, so under fail-open every Canadian cell would price as
 * permanently clear — the cheapest way around any storm in the northern tier.
 * These are the routes where that would have shown up.
 */

import { cellId, isForeignLand, isUsLand, parseCellId } from '@smoke/shared';
import { describe, expect, it } from 'vitest';

import { planRoute } from '../../src/routing/astar.js';
import { CONFIG, cellRect, weatherFixture } from '../fixtures/weather.js';

const CLEAR = weatherFixture();

const DETROIT = cellId({ lat: 42.3314, lng: -83.0458 });
const BUFFALO = cellId({ lat: 42.8864, lng: -78.8784 });
const SEATTLE = cellId({ lat: 47.6062, lng: -122.3321 });
const BOSTON = cellId({ lat: 42.3601, lng: -71.0589 });
const MINNEAPOLIS = cellId({ lat: 44.9778, lng: -93.265 });

/** Michigan and the lakes, wide enough to close the direct corridor. */
const MICHIGAN_STORM = cellRect([40, 48], [70, 80]);

function route(origin: string, dest: string, weather = CLEAR) {
  const result = planRoute({ origin, dest, weather, config: CONFIG });
  if (result.status !== 'OK') throw new Error(`expected a route, got ${result.reason}`);
  return result;
}

describe('Detroit → Buffalo goes south of Lake Erie', () => {
  it('stays entirely in US cells', () => {
    const result = route(DETROIT, BUFFALO);
    for (const cell of result.route) {
      expect(isUsLand(cell), `${cell} is not US land`).toBe(true);
    }
  });

  it('crosses no water and no border', () => {
    const result = route(DETROIT, BUFFALO);
    expect(result.route.filter(isForeignLand)).toEqual([]);
    // Lake Erie's own cells are water; going south of the lake means none appear.
    expect(result.route.filter((cell) => !isUsLand(cell))).toEqual([]);
  });

  it('is barely longer than the straight line, so the detour is the lake shore', () => {
    const result = route(DETROIT, BUFFALO);
    expect(result.totalHours).toBeGreaterThan(14);
    expect(result.totalHours).toBeLessThan(20);
  });
});

describe('a storm over Michigan does not push a route into Ontario', () => {
  it('detours south through Ohio instead', () => {
    const weather = weatherFixture([MICHIGAN_STORM, { impassable: true }]);
    const result = route(DETROIT, BUFFALO, weather);

    expect(result.route.filter(isForeignLand)).toEqual([]);
    for (const cell of result.route) expect(isUsLand(cell)).toBe(true);
    // Southward, not northward: no cell ends up north of the origin's latitude band.
    const northmost = Math.max(...result.route.map((c) => parseCellId(c).row));
    expect(northmost).toBeLessThanOrEqual(parseCellId(BUFFALO).row);
  });

  it('would have had a cheap Canadian shortcut if the border were open', () => {
    // Sanity check on the fixture: Ontario cells north of the corridor exist and
    // are storm-free — they are excluded by the mask, not by the weather.
    const ontario = cellRect([43, 46], [81, 88])
      .filter(isForeignLand)
      .filter((cell) => !MICHIGAN_STORM.includes(cell));
    expect(ontario.length).toBeGreaterThan(3);
    const weather = weatherFixture([MICHIGAN_STORM, { impassable: true }]);
    for (const cell of ontario) {
      expect(weather.get(cell)).toBeUndefined(); // clear under fail-open
      expect(planRoute({ origin: DETROIT, dest: cell, weather, config: CONFIG }).status).toBe(
        'NO_ROUTE',
      );
    }
  });
});

describe('long domestic routes stay domestic', () => {
  it('Seattle → Boston never leaves the United States', () => {
    const result = route(SEATTLE, BOSTON);
    expect(result.route.length).toBeGreaterThan(80);
    for (const cell of result.route) {
      expect(isUsLand(cell), `${cell} (${result.route.indexOf(cell)}) is not US land`).toBe(true);
    }
  });

  it('Minneapolis → Boston does not shortcut across the Great Lakes into Canada', () => {
    const result = route(MINNEAPOLIS, BOSTON);
    expect(result.route.filter(isForeignLand)).toEqual([]);
  });

  it('refuses to deliver to a foreign cell at all', () => {
    const toronto = cellId({ lat: 43.6532, lng: -79.3832 });
    expect(isForeignLand(toronto)).toBe(true);
    const result = planRoute({ origin: DETROIT, dest: toronto, weather: CLEAR, config: CONFIG });
    expect(result.status).toBe('NO_ROUTE');
    if (result.status === 'NO_ROUTE') expect(result.reason).toBe('dest_unreachable');
  });
});
