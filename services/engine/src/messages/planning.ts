/**
 * Route planning as the lifecycle uses it: fetch the corridor, plan, and — for
 * anything the user is about to commit to — resolve the guesses first.
 *
 * REDTEAM F18: fail-open prices unfetched cells as clear, which makes unknown
 * terrain *attractive* to A*. A preview that quoted such a route would be
 * promising an ETA through weather nobody has ever looked at. So a committed
 * plan fetches every unknown cell on its candidate route and re-routes once.
 * Mid-flight replanning keeps the plain fail-open behaviour: there, availability
 * beats precision (REDTEAM F4).
 */

import { planRoute } from '../routing/astar.js';
import type { RouteResult } from '../routing/astar.js';
import { snapshotFrom } from '../weather/types.js';
import type { CellWeather, WeatherSnapshot } from '../weather/types.js';
import { cellsInBoundingBox, expandWithPadding } from '@smoke/shared';
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
  /** Safety valve on the resolve loop. */
  maxRounds?: number;
}

/** Cells the router used that we have never actually looked at. */
function neverFetched(weather: WeatherSnapshot, route: readonly CellId[]): CellId[] {
  return route.filter((cell) => weather.get(cell) === undefined);
}

const DEFAULT_MAX_ROUNDS = 5;

export async function planJourney(
  ctx: EngineContext,
  origin: CellId,
  dest: CellId,
  options: PlanOptions,
): Promise<PlannedJourney> {
  let weather = await ctx.weather.getCorridorWeather(origin, dest);
  let result = planRoute({ origin, dest, weather, config: ctx.config });
  const resolvedUnknowns: CellId[] = [];

  // REDTEAM F18. Note the distinction: cells we have *never fetched* get fetched
  // — leaving them as clear guesses is what makes unknown terrain attractive to
  // A*. Cells that NWS genuinely has nothing for stay failed-open at 1.0×, which
  // is the rule that keeps an outage from stranding the network (F4).
  const maxRounds = options.maxRounds ?? DEFAULT_MAX_ROUNDS;
  for (let round = 0; options.resolveUnknowns && round < maxRounds; round++) {
    if (result.status !== 'OK') break;
    const missing = neverFetched(weather, result.route);
    if (missing.length === 0) break;

    // Fetch the whole region the candidate route crosses, not just the cells it
    // touches: a storm line makes the router try gap after gap, and resolving one
    // cell at a time turns that into whack-a-mole.
    const region = expandWithPadding(
      cellsInBoundingBox(result.route),
      ctx.config.get('grid.prefetch_padding_cells'),
    ).filter((cell) => weather.get(cell) === undefined);

    resolvedUnknowns.push(...missing);
    ctx.log(`plan: fetching ${region.length} never-seen cells before committing a route`);
    weather = merge(weather, await ctx.weather.getCellWeather(region));
    result = planRoute({ origin, dest, weather, config: ctx.config });
  }

  return {
    result,
    weather,
    resolvedUnknowns,
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
  return planJourney(ctx, from, dest, { resolveUnknowns: true });
}
