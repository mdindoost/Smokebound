/**
 * Tower density: a map is a rectangle, a timeline is a scroll.
 */

import { describe, expect, it } from 'vitest';

import { MAX_TOWER_MARKS, thinTowers } from '../src/map/towerDensity';
import type { Tower } from '../src/map/towerDensity';

const route = (n: number): Tower[] =>
  Array.from({ length: n }, (_, i) => ({ cell: `r0${30 + (i % 9)}c${100 + i}`, name: `T${i}` }));

describe('thinTowers', () => {
  it('leaves a short route alone', () => {
    const two = route(2);
    expect(thinTowers(two)).toEqual(two);
  });

  it('caps a continental route at something a panel can hold', () => {
    // The Denver route: ~60 towers tiling into a solid band across the map.
    expect(thinTowers(route(60)).length).toBeLessThanOrEqual(MAX_TOWER_MARKS);
  });

  it('always keeps both ends', () => {
    const long = route(60);
    const thinned = thinTowers(long);
    expect(thinned[0]).toEqual(long[0]);
    expect(thinned.at(-1)).toEqual(long.at(-1));
  });

  it('keeps them in order and never repeats one', () => {
    const thinned = thinTowers(route(60));
    const cells = thinned.map((t) => t.cell);
    expect(new Set(cells).size).toBe(cells.length);
    const indexes = thinned.map((t) => Number(t.name.slice(1)));
    expect([...indexes].sort((a, b) => a - b)).toEqual(indexes);
  });

  it('spaces them evenly rather than clumping', () => {
    // Even spacing is what makes the thinned set still read as a *path*.
    const thinned = thinTowers(route(60));
    const gaps = thinned.slice(1).map((t, i) => Number(t.name.slice(1)) - Number(thinned[i]!.name.slice(1)));
    expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThanOrEqual(1);
  });

  it('degrades to the two ends when asked for almost nothing', () => {
    expect(thinTowers(route(60), 2)).toHaveLength(2);
  });
});
