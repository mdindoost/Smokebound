/**
 * A* over the cell grid (ARCHITECTURE §6.2).
 *
 * Pure: `(origin, dest, weather snapshot, config) → route`. No I/O, no clock, no
 * randomness — the same inputs always produce the same route, which is what
 * makes storm fixtures and the Dijkstra cross-check meaningful.
 *
 * Traversability has two independent gates:
 *  - the land mask (MECHANICS §1.1) — open ocean is not part of the world;
 *  - `impassable` in the weather snapshot — an active severe warning (REDTEAM F2).
 * Both prune the cell entirely rather than pricing it.
 */

import { formatCellId, isTraversable, neighbors, parseCellId, GRID } from '@smoke/shared';
import type { CellId, MechanicsConfig } from '@smoke/shared';

import { heuristicHours, hopHours } from './cost.js';
import type { WeatherSnapshot } from '../weather/types.js';

export interface RouteWaypoint {
  leg: number;
  cell: CellId;
  /** Hours from departure to arriving here. Leg 0 is the origin, at 0 hours. */
  cumulativeHours: number;
}

export interface RouteFound {
  status: 'OK';
  route: CellId[];
  waypoints: RouteWaypoint[];
  totalHours: number;
  /**
   * Cells on the chosen route whose weather we are guessing (fail-open, or never
   * fetched). The caller may want to fetch these and replan — under fail-open an
   * unknown cell is priced as clear, which makes it *attractive* to the router.
   */
  unknownCells: CellId[];
  /** How many cells A* expanded — useful for cost/perf regression tests. */
  expanded: number;
}

export interface NoRoute {
  status: 'NO_ROUTE';
  reason: 'origin_unreachable' | 'dest_unreachable' | 'no_path';
  expanded: number;
}

export type RouteResult = RouteFound | NoRoute;

export interface PlanRouteOptions {
  origin: CellId;
  dest: CellId;
  weather: WeatherSnapshot;
  config: MechanicsConfig;
  /**
   * Allow a diagonal hop to pass between two blocked cells. Off by default: a
   * one-cell-thick storm wall should be a wall, not a sieve.
   */
  allowCornerCutting?: boolean;
}

/** Binary min-heap keyed by f, tie-broken by h then index for determinism. */
class Heap {
  private readonly items: { index: number; f: number; h: number }[] = [];

  get size(): number {
    return this.items.length;
  }

  push(item: { index: number; f: number; h: number }): void {
    this.items.push(item);
    let i = this.items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.less(i, parent)) {
        this.swap(i, parent);
        i = parent;
      } else break;
    }
  }

  pop(): { index: number; f: number; h: number } | undefined {
    const top = this.items[0];
    const last = this.items.pop();
    if (this.items.length > 0 && last !== undefined) {
      this.items[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let smallest = i;
        if (l < this.items.length && this.less(l, smallest)) smallest = l;
        if (r < this.items.length && this.less(r, smallest)) smallest = r;
        if (smallest === i) break;
        this.swap(i, smallest);
        i = smallest;
      }
    }
    return top;
  }

  private less(a: number, b: number): boolean {
    const x = this.items[a]!;
    const y = this.items[b]!;
    if (x.f !== y.f) return x.f < y.f;
    if (x.h !== y.h) return x.h < y.h;
    return x.index < y.index;
  }

  private swap(a: number, b: number): void {
    const tmp = this.items[a]!;
    this.items[a] = this.items[b]!;
    this.items[b] = tmp;
  }
}

const toIndex = (cell: CellId): number => {
  const { row, col } = parseCellId(cell);
  return row * GRID.cols + col;
};

const fromIndex = (index: number): CellId =>
  formatCellId({ row: Math.floor(index / GRID.cols), col: index % GRID.cols });

/** A cell smoke may enter: on the map, and not walled off by severe weather. */
export function isEnterable(cell: CellId, weather: WeatherSnapshot): boolean {
  if (!isTraversable(cell)) return false;
  return weather.get(cell)?.impassable !== true;
}

export function planRoute(options: PlanRouteOptions): RouteResult {
  const { origin, dest, weather, config } = options;
  const allowCornerCutting = options.allowCornerCutting ?? false;

  // The origin is never pruned: a fire under a storm still lights, it just may
  // not be able to go anywhere yet (that is STRANDED, decided by the caller).
  if (!isTraversable(origin)) return { status: 'NO_ROUTE', reason: 'origin_unreachable', expanded: 0 };
  if (!isEnterable(dest, weather)) {
    return { status: 'NO_ROUTE', reason: 'dest_unreachable', expanded: 0 };
  }

  if (origin === dest) {
    return {
      status: 'OK',
      route: [origin],
      waypoints: [{ leg: 0, cell: origin, cumulativeHours: 0 }],
      totalHours: 0,
      unknownCells: unknownAmong([origin], weather),
      expanded: 0,
    };
  }

  const originIndex = toIndex(origin);
  const destIndex = toIndex(dest);

  const gScore = new Map<number, number>([[originIndex, 0]]);
  const cameFrom = new Map<number, number>();
  const closed = new Set<number>();
  const open = new Heap();
  open.push({ index: originIndex, f: heuristicHours(origin, dest, config), h: 0 });

  let expanded = 0;

  while (open.size > 0) {
    const current = open.pop()!;
    if (closed.has(current.index)) continue;
    closed.add(current.index);
    expanded++;

    if (current.index === destIndex) {
      return buildRoute(cameFrom, gScore, originIndex, destIndex, weather, expanded);
    }

    const currentCell = fromIndex(current.index);
    const g = gScore.get(current.index)!;

    for (const neighbor of neighbors(currentCell)) {
      const neighborIndex = toIndex(neighbor);
      if (closed.has(neighborIndex)) continue;
      if (!canHop(currentCell, neighbor, weather, allowCornerCutting)) continue;

      const tentative = g + hopHours(currentCell, neighbor, weather, config);
      const known = gScore.get(neighborIndex);
      if (known !== undefined && tentative >= known) continue;

      gScore.set(neighborIndex, tentative);
      cameFrom.set(neighborIndex, current.index);
      const h = heuristicHours(neighbor, dest, config);
      open.push({ index: neighborIndex, f: tentative + h, h });
    }
  }

  return { status: 'NO_ROUTE', reason: 'no_path', expanded };
}

/** Whether a single hop is legal, given the traversability and corner rules. */
export function canHop(
  from: CellId,
  to: CellId,
  weather: WeatherSnapshot,
  allowCornerCutting = false,
): boolean {
  if (!isEnterable(to, weather)) return false;
  return allowCornerCutting || !isBlockedCorner(from, to, weather);
}

/**
 * A diagonal hop squeezes between two orthogonal cells. If both of those are
 * blocked, the smoke would be threading the corner of two storms — disallowed.
 */
function isBlockedCorner(from: CellId, to: CellId, weather: WeatherSnapshot): boolean {
  const a = parseCellId(from);
  const b = parseCellId(to);
  if (a.row === b.row || a.col === b.col) return false; // not a diagonal

  const sideA = formatCellId({ row: a.row, col: b.col });
  const sideB = formatCellId({ row: b.row, col: a.col });
  return !isEnterable(sideA, weather) && !isEnterable(sideB, weather);
}

function unknownAmong(cells: readonly CellId[], weather: WeatherSnapshot): CellId[] {
  return cells.filter((cell) => {
    const entry = weather.get(cell);
    return entry === undefined || entry.weatherUnknown;
  });
}

function buildRoute(
  cameFrom: Map<number, number>,
  gScore: Map<number, number>,
  originIndex: number,
  destIndex: number,
  weather: WeatherSnapshot,
  expanded: number,
): RouteFound {
  const indices: number[] = [destIndex];
  let cursor = destIndex;
  while (cursor !== originIndex) {
    cursor = cameFrom.get(cursor)!;
    indices.push(cursor);
  }
  indices.reverse();

  const route = indices.map(fromIndex);
  const waypoints: RouteWaypoint[] = indices.map((index, leg) => ({
    leg,
    cell: fromIndex(index),
    cumulativeHours: gScore.get(index)!,
  }));

  return {
    status: 'OK',
    route,
    waypoints,
    totalHours: gScore.get(destIndex)!,
    unknownCells: unknownAmong(route, weather),
    expanded,
  };
}

/** DB shape for `messages.segment_etas` (ARCHITECTURE §3), given a departure time. */
export function toSegmentEtas(
  waypoints: readonly RouteWaypoint[],
  departedAt: Date,
): { leg: number; cell: CellId; cumulative_hours: number; eta: string }[] {
  return waypoints.map((w) => ({
    leg: w.leg,
    cell: w.cell,
    cumulative_hours: w.cumulativeHours,
    eta: new Date(departedAt.getTime() + w.cumulativeHours * 3_600_000).toISOString(),
  }));
}
