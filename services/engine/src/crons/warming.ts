/**
 * warming — keeping the sky warm ahead of the people who need it (REDTEAM F31).
 *
 * Before this existed, weather was fetched lazily, per corridor, synchronously,
 * while a user waited. Measured on a real phone that was six minutes for a
 * cross-country route against a 45-second timeout — a person staring at a
 * spinner while we asked NWS about Ohio.
 *
 * The obvious fix is worse than the problem. A full-grid sweep is 3,444
 * traversable cells; at measured throughput that is about an hour against a
 * 30-minute TTL, so every lap would finish with half the country already stale.
 * It would burn NWS quota forever and never once deliver a warm cache.
 *
 * So this is deliberately **partial and prioritised**. It warms the sky people
 * are actually using, in the order they will need it, and stops when its budget
 * is spent:
 *
 *   1. The corridors of messages in the air — those get replanned every 15
 *      minutes and stranded ones need the gap the moment it opens.
 *   2. The fires of people we have seen lately, and the corridors between flock
 *      pairs with recent traffic — where the next send is most likely to start.
 *
 * Everything else stays cold until somebody wants it, and pays the (now much
 * smaller) F28 budget when they do. A grid that is 20% warm in the right 20% is
 * worth more than one that is uniformly stale.
 */

import { cellsAlongGreatCircle, cellsInBoundingBox, expandWithPadding } from '@smoke/shared';
import type { CellId } from '@smoke/shared';

import type { EngineContext } from '../engine/context.js';
import { messagesInStates } from '../db/repo.js';

export interface WarmingStats {
  /** Cells wanted, in priority order, before the budget was applied. */
  wanted: number;
  /** Cells actually handed to the weather cache. */
  warmed: number;
  /** Cells dropped because the budget ran out. Logged, never silent. */
  skipped: number;
  activeRoutes: number;
  activeFires: number;
}

/** Priority 1: where smoke is right now, plus a cell of shoulder. */
async function inFlightCorridors(ctx: EngineContext): Promise<{ cells: CellId[]; routes: number }> {
  const flying = await messagesInStates(ctx.db, ['IN_FLIGHT', 'STRANDED', 'TRANSMITTING']);
  const padding = ctx.config.get('grid.prefetch_padding_cells');
  const cells: CellId[] = [];

  for (const message of flying) {
    const route = Array.isArray(message.route) && message.route.length > 0
      ? (message.route as CellId[])
      : cellsAlongGreatCircle(message.origin_cell, message.dest_cell);
    cells.push(...expandWithPadding(cellsInBoundingBox(route), padding));
  }
  return { cells, routes: flying.length };
}

/** Priority 2: fires that have been tended lately, and the ways between them. */
async function livePlaces(ctx: EngineContext): Promise<{ cells: CellId[]; fires: number }> {
  const days = ctx.config.get('warming.active_user_days');

  const { rows: fires } = await ctx.db.query<{ home_cell: CellId }>(
    `select distinct home_cell from public.profiles
      where is_system = false
        and last_active_at is not null
        and last_active_at > now() - ($1 || ' days')::interval`,
    [String(days)],
  );

  // Corridors between people who have actually written to each other. A flock
  // edge alone is not evidence of traffic; a message is.
  const { rows: pairs } = await ctx.db.query<{ origin_cell: CellId; dest_cell: CellId }>(
    `select distinct m.origin_cell, m.dest_cell
       from public.messages m
      where m.created_at > now() - ($1 || ' days')::interval`,
    [String(days)],
  );

  const cells: CellId[] = fires.map((row) => row.home_cell);
  for (const pair of pairs) {
    cells.push(...cellsAlongGreatCircle(pair.origin_cell, pair.dest_cell));
  }
  return { cells, fires: fires.length };
}

export async function runWarming(ctx: EngineContext): Promise<WarmingStats> {
  const budget = ctx.config.get('warming.cells_per_pass');

  const flights = await inFlightCorridors(ctx);
  const places = await livePlaces(ctx);

  // Order matters and duplicates do not: a Set preserves insertion order, so
  // priority 1 keeps its place at the front and priority 2 fills what is left.
  const wanted = [...new Set([...flights.cells, ...places.cells])];
  const warm = wanted.slice(0, budget);
  const skipped = wanted.length - warm.length;

  if (warm.length > 0) await ctx.weather.getCellWeather(warm);

  if (skipped > 0) {
    // Never truncate quietly. A pass that silently drops half its work looks
    // exactly like a pass that had nothing to do.
    ctx.log(
      `warming: budget ${budget} spent, ${skipped} cells left cold ` +
        `(${flights.routes} in flight, ${places.fires} live fires)`,
    );
  }

  return {
    wanted: wanted.length,
    warmed: warm.length,
    skipped,
    activeRoutes: flights.routes,
    activeFires: places.fires,
  };
}
