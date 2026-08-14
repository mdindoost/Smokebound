/**
 * Reference shortest-path implementation for the router tests.
 *
 * Plain Dijkstra — no heuristic, no early exit on a stale queue entry — sharing
 * only the cost model and hop rules with A*. If A* ever returns a costlier route
 * than this, its heuristic is inadmissible.
 */

import { neighbors } from '@smoke/shared';
import type { CellId, MechanicsConfig } from '@smoke/shared';

import { canHop, isEnterable } from '../../src/routing/astar.js';
import { hopHours } from '../../src/routing/cost.js';
import type { WeatherSnapshot } from '../../src/weather/types.js';

export interface DijkstraResult {
  totalHours: number | null;
  route: CellId[] | null;
}

export function dijkstra(
  origin: CellId,
  dest: CellId,
  weather: WeatherSnapshot,
  config: MechanicsConfig,
): DijkstraResult {
  if (!isEnterable(dest, weather)) return { totalHours: null, route: null };

  const dist = new Map<CellId, number>([[origin, 0]]);
  const prev = new Map<CellId, CellId>();
  const done = new Set<CellId>();
  // Small graph; a linear scan of the frontier keeps the reference obviously correct.
  const frontier = new Set<CellId>([origin]);

  while (frontier.size > 0) {
    let current: CellId | null = null;
    let best = Infinity;
    for (const cell of frontier) {
      const d = dist.get(cell)!;
      if (d < best) {
        best = d;
        current = cell;
      }
    }
    if (current === null) break;

    frontier.delete(current);
    done.add(current);

    if (current === dest) break;

    for (const neighbor of neighbors(current)) {
      if (done.has(neighbor)) continue;
      if (!canHop(current, neighbor, weather)) continue;
      const candidate = best + hopHours(current, neighbor, weather, config);
      if (candidate < (dist.get(neighbor) ?? Infinity)) {
        dist.set(neighbor, candidate);
        prev.set(neighbor, current);
        frontier.add(neighbor);
      }
    }
  }

  const total = dist.get(dest);
  if (total === undefined) return { totalHours: null, route: null };

  const route: CellId[] = [dest];
  let cursor = dest;
  while (cursor !== origin) {
    cursor = prev.get(cursor)!;
    route.push(cursor);
  }
  route.reverse();
  return { totalHours: total, route };
}
