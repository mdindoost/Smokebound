/**
 * The night chain (M5.7).
 *
 * Device evidence at 3:29 AM: a fire drifting across the map as a dot. Fire does
 * not travel — towers kindle in sequence, and the signal's position is which
 * tower is currently burning.
 */

import { describe, expect, it } from 'vitest';

import { chainFor } from '../src/map/chain';
import { towerMarkSize, CURRENT_TOWER_SCALE } from '../src/design/marks';

// A short real route: Little Falls → Matawan, both named.
const ROUTE = ['r037c090', 'r036c090'];

describe('chainFor', () => {
  it('blazes at the last tower the engine has confirmed', () => {
    const chain = chainFor(ROUTE, ['r037c090']);
    expect(chain.map((link) => link.phase)).toEqual(['current', 'ahead']);
  });

  it('moves the blaze forward as legs are confirmed', () => {
    const chain = chainFor(ROUTE, ROUTE);
    expect(chain.map((link) => link.phase)).toEqual(['passed', 'current']);
  });

  it('lights nothing before departure', () => {
    // Nothing confirmed: no tower may claim to have carried the signal.
    const chain = chainFor(ROUTE, []);
    expect(chain.every((link) => link.phase === 'ahead')).toBe(true);
  });

  it('never lights a tower the engine has not confirmed (DESIGN.md V7)', () => {
    // The whole reason the chain is anchored on current_leg: a drifting dot
    // between waypoints is obviously an approximation, but a *lit tower* is a
    // claim that the fire reached that station.
    const chain = chainFor(ROUTE, ['r037c090']);
    const lit = chain.filter((link) => link.phase !== 'ahead').map((link) => link.cell);
    expect(lit).toEqual(['r037c090']);
  });

  it('names every link', () => {
    for (const link of chainFor(ROUTE, ROUTE)) {
      expect(link.name.length).toBeGreaterThan(0);
    }
  });

  it('has exactly one blaze, or none', () => {
    for (const confirmed of [[], ['r037c090'], ROUTE]) {
      const blazes = chainFor(ROUTE, confirmed).filter((l) => l.phase === 'current');
      expect(blazes.length).toBeLessThanOrEqual(1);
    }
  });
});

describe('chain marks scale with zoom (R22 still governs size)', () => {
  it('draws a landmark up close and a dot from orbit', () => {
    expect(towerMarkSize(0.5)).toBeGreaterThan(towerMarkSize(40));
  });

  it('makes the blazing tower the loudest thing on the panel', () => {
    // It is doing the job the drifting ember does by day.
    expect(CURRENT_TOWER_SCALE).toBeGreaterThan(1.5);
  });
});
