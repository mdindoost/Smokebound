import { describe, expect, it } from 'vitest';

import { cellId, formatCellId } from './grid.js';
import { isTraversable } from './land.js';
import { towerNameFor, towerPhrase, towersAlong } from './towers.js';
import { cellsAlongGreatCircle } from './greatCircle.js';

const NEWARK = cellId({ lat: 40.7357, lng: -74.1724 });
const CHICAGO = cellId({ lat: 41.8781, lng: -87.6298 });

describe('the tower layer (SPEC §3 v1.1)', () => {
  it('names a tower in every routable cell, and none anywhere else', () => {
    let named = 0;
    for (let row = 0; row < 57; row++) {
      for (let col = 0; col < 106; col++) {
        const cell = formatCellId({ row, col });
        const name = towerNameFor(cell);
        if (isTraversable(cell)) {
          expect(name, cell).not.toBeNull();
          named++;
        } else {
          expect(name, cell).toBeNull();
        }
      }
    }
    expect(named).toBeGreaterThan(3000);
  });

  it('names cells after somewhere recognisably nearby', () => {
    // The name comes from the nearest place to the *cell centre*, which is up to
    // 25 km from the city that happens to sit in the cell — so these are metro
    // areas, not exact city matches.
    expect(towerNameFor(NEWARK)).toMatch(
      /Newark|New York|Elizabeth|Jersey|Hoboken|Bayonne|Clifton|Paterson|Passaic|Montclair|Bloomfield|Little Falls|Nutley|Belleville/,
    );
    expect(towerNameFor(CHICAGO)).toMatch(
      /Chicago|Cicero|Berwyn|Oak Park|Evanston|Skokie|Norridge|Elmwood/,
    );
    expect(towerNameFor(cellId({ lat: 39.7392, lng: -104.9903 }))).toMatch(
      /Denver|Aurora|Lakewood|Arvada|Westminster|Englewood|Glendale|Commerce City|Thornton|Lafayette|Broomfield|Louisville|Boulder|Erie/,
    );
  });

  it('gives every tower a plausible place name', () => {
    for (const cell of [NEWARK, CHICAGO, cellId({ lat: 31.7619, lng: -106.485 })]) {
      const name = towerNameFor(cell)!;
      expect(name.length).toBeGreaterThan(2);
      expect(name).not.toMatch(/[0-9]/);
    }
    expect(towerNameFor(NEWARK)).not.toBe(towerNameFor(CHICAGO));
  });

  it('phrases a tower the way the timeline says it', () => {
    expect(towerPhrase(NEWARK)).toBe(`the ${towerNameFor(NEWARK)} tower`);
    expect(towerPhrase(cellId({ lat: 33.0, lng: -73.0 }))).toBeNull(); // open ocean
  });

  it('is deterministic', () => {
    expect(towerNameFor(NEWARK)).toBe(towerNameFor(NEWARK));
  });

  it('does not stutter along a route', () => {
    const route = cellsAlongGreatCircle(NEWARK, CHICAGO);
    const towers = towersAlong(route);

    expect(towers.length).toBeGreaterThan(5);
    expect(towers.length).toBeLessThanOrEqual(route.length);
    for (let i = 1; i < towers.length; i++) {
      expect(towers[i]!.name).not.toBe(towers[i - 1]!.name);
    }
    for (const tower of towers) expect(route).toContain(tower.cell);
  });

  it('has nothing to say about an empty route', () => {
    expect(towersAlong([])).toEqual([]);
  });
});
