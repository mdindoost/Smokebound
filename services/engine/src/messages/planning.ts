/**
 * Route planning as the lifecycle uses it.
 *
 * F18 made a committed plan resolve every unknown cell on its candidate route
 * before quoting, because fail-open priced the unexplored as clear and so made
 * it *attractive* to A*. Measured on real hardware that cost six minutes for a
 * cross-country route against a 45-second timeout — the prefetch was buying the
 * whole padded corridor, and doing it while a person waited.
 *
 * REDTEAM F29 removed the reason: never-fetched cells now cost
 * `routing.unknown_cost_mult`, so the router no longer seeks them out and a plan
 * made in partial knowledge is a reasonable plan rather than a fantasy.
 *
 * REDTEAM F28 therefore splits the two callers apart:
 *
 *   - **Committing** (preview, send) plans on what is cached, then spends a hard
 *     `preview.resolve_budget_seconds` on the candidate route's **own cells** —
 *     no bounding box, no padding — and replans once with whatever arrived.
 *     Anything still unknown is priced, not waited for.
 *   - **Replanning** in flight keeps the padded corridor. Nobody is watching a
 *     spinner there, and breadth is worth more than latency (REDTEAM F4).
 *
 * The corridor breadth a preview used to buy has not been abandoned — it moved
 * to the warming cron (F31), where it runs on our time instead of the user's.
 */

import { planRoute } from '../routing/astar.js';
import type { RouteResult } from '../routing/astar.js';
import { snapshotFrom } from '../weather/types.js';
import type { CellWeather, WeatherSnapshot } from '../weather/types.js';
import { cellsAlongGreatCircle, cellsInBoundingBox, expandWithPadding } from '@smoke/shared';
import type { CellId } from '@smoke/shared';
import type { EngineContext } from '../engine/context.js';

export interface StormNote {
  cell: CellId;
  condition: string;
  impassable: boolean;
}

export interface PlannedJourney {
  result: RouteResult;
  weather: WeatherSnapshot;
  /** Cells we went back and fetched because the first route relied on guesses. */
  resolvedUnknowns: CellId[];
  /**
   * Cells on the committed route we never got to look at before the budget ran
   * out (REDTEAM F28). Priced, not waited for — and the width of the quoted ETA
   * band is a function of how many there are (F30).
   */
  unresolved: CellId[];
  /** Bad weather in the corridor that the chosen route steers around. */
  stormsAvoided: StormNote[];
}

/** How many storms a preview bothers to name. */
const MAX_STORM_NOTES = 20;

function merge(base: WeatherSnapshot, extra: WeatherSnapshot): WeatherSnapshot {
  const entries = new Map<CellId, CellWeather>();
  for (const cell of base.cells()) entries.set(cell, base.get(cell)!);
  for (const cell of extra.cells()) entries.set(cell, extra.get(cell)!);
  return snapshotFrom(entries.values());
}

function stormsAvoided(
  ctx: EngineContext,
  weather: WeatherSnapshot,
  route: readonly CellId[],
): StormNote[] {
  const onRoute = new Set(route);
  const stormThreshold = ctx.config.get('weather.time_mult').thunderstorm;
  const notes: StormNote[] = [];

  for (const cell of weather.cells()) {
    if (onRoute.has(cell)) continue;
    const entry = weather.get(cell)!;
    if (entry.source === 'ocean') continue; // geography, not weather
    if (entry.impassable || entry.timeMult >= stormThreshold) {
      notes.push({ cell, condition: entry.condition, impassable: entry.impassable });
    }
  }
  return notes.slice(0, MAX_STORM_NOTES);
}

export interface PlanOptions {
  /**
   * Fetch the weather for cells on the candidate route that were never fetched,
   * and replan. Any route we are about to commit to gets this.
   */
  resolveUnknowns: boolean;
  /**
   * Fetch the padded corridor before planning at all.
   *
   * Replan passes do; commits do not (REDTEAM F28) — that breadth is the warming
   * cron's job now, and a person is waiting on a commit.
   */
  prefetchCorridor?: boolean;
  /** Wall-clock ceiling on resolution. Defaults to `preview.resolve_budget_seconds`. */
  budgetMs?: number;
  /**
   * When the smoke actually leaves (MECHANICS-V2 §4.4).
   *
   * Makes hop costs time-dependent: each hop is priced by the sun at its
   * predicted entry time. Omit it and everything prices as daylight, which is
   * v1 behaviour — and is what `night.enabled = false` reduces to.
   */
  departAt?: Date | null;
}

/** Cells the router used that we have never actually looked at. */
function neverFetched(weather: WeatherSnapshot, route: readonly CellId[]): CellId[] {
  return route.filter((cell) => weather.get(cell) === undefined);
}

/**
 * A backstop, not the control. REDTEAM F28 makes the bound wall-clock — "a hard
 * time budget of 10 seconds" — precisely because counting rounds is the wrong
 * unit: one round is too few when a storm line walls off the origin and the
 * router has to try gap after gap, and five is far too many when each round is
 * buying a continent. The budget stops it; this only stops a runaway.
 */
const MAX_ROUNDS = 12;

export async function planJourney(
  ctx: EngineContext,
  origin: CellId,
  dest: CellId,
  options: PlanOptions,
): Promise<PlannedJourney> {
  const corridor = cellsAlongGreatCircle(origin, dest);

  // A replan buys breadth; a commit spends only what it already has, then pays
  // for the route it actually chose (REDTEAM F28).
  let weather =
    options.prefetchCorridor === true
      ? await ctx.weather.getCorridorWeather(origin, dest)
      : await ctx.weather.getCachedWeather(
          expandWithPadding(cellsInBoundingBox(corridor), ctx.config.get('grid.prefetch_padding_cells')),
        );

  const departAt = options.departAt ?? null;
  let result = planRoute({ origin, dest, weather, config: ctx.config, departAt });
  const resolvedUnknowns: CellId[] = [];
  let unresolved: CellId[] = [];

  if (options.resolveUnknowns) {
    const budgetMs =
      options.budgetMs ?? ctx.config.get('preview.resolve_budget_seconds') * 1000;
    const deadline = new Date(ctx.clock.now().getTime() + budgetMs);

    for (let round = 0; round < MAX_ROUNDS; round++) {
      if (result.status !== 'OK') break;
      if (ctx.clock.now().getTime() >= deadline.getTime()) break;
      const missing = neverFetched(weather, result.route);
      if (missing.length === 0) break;

      ctx.log(`plan: resolving ${missing.length} unseen cells on the chosen route`);
      weather = merge(weather, await ctx.weather.getCellWeather(missing, { deadline }));
      resolvedUnknowns.push(...missing.filter((cell) => weather.get(cell) !== undefined));
      result = planRoute({ origin, dest, weather, config: ctx.config, departAt });
    }

    // What the budget did not buy. Priced at routing.unknown_cost_mult and
    // reported, so the quote can widen its band honestly rather than pretend.
    unresolved = result.status === 'OK' ? neverFetched(weather, result.route) : [];
    if (unresolved.length > 0) {
      ctx.log(`plan: quoting with ${unresolved.length} cells still unseen`);
    }
  }

  return {
    result,
    weather,
    resolvedUnknowns,
    unresolved,
    stormsAvoided: result.status === 'OK' ? stormsAvoided(ctx, weather, result.route) : [],
  };
}

/**
 * Replan from where a message actually is (in flight or stranded).
 *
 * This also resolves never-fetched cells: a replan commits a route just as a
 * send does, and a message that "resumed" through unlooked-at terrain would be
 * flying on an invented forecast.
 */
export async function replanFrom(
  ctx: EngineContext,
  from: CellId,
  dest: CellId,
): Promise<PlannedJourney> {
  // Breadth here, not latency: this runs on a cron, and a wider corridor is what
  // lets a stranded message find the gap when the storm moves (REDTEAM F28).
  // A replan departs *now* — the smoke is already in the air, and this is the
  // pass that corrects a frozen plan whose sun assumptions have drifted
  // (MECHANICS-V2 §4.4).
  return planJourney(ctx, from, dest, {
    resolveUnknowns: true,
    prefetchCorridor: true,
    departAt: ctx.clock.now(),
  });
}
