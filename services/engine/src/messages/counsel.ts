/**
 * "Send at dusk" (MECHANICS-V2 §5).
 *
 * Advisory copy on the compose screen: the engine plans the same route from a
 * handful of candidate departure times and, if one is meaningfully better, says
 * so. **It never delays a send.** The fire is lit when the player says so; this
 * product's whole posture is that the sky decides and the person chooses.
 *
 * Three rulings shape everything here.
 *
 * **F42 — one comparison, one source.** Every candidate, *including "send now"*,
 * prices from `forecast_hours`. The draft priced "now" from `weather_cells` and
 * the later candidates from the hourly product, which would have made counsel
 * measure the difference between two forecast products rather than the sky:
 * hourly forecasts are smoothed, so if they run milder than current-condition
 * readings, counsel would have advised waiting for reasons that were purely an
 * artefact of table choice — and the advice would have looked plausible every
 * single time. `weather_cells` stays the authority for real sends and replans.
 *
 * **F38 — quiet unless it matters.** Counsel speaks only when the best candidate
 * beats sending now by at least `max(counsel.min_abs_minutes, counsel.min_fraction
 * × send-now ETA)`, and never proposes waiting longer than the time it saves.
 * Combined with the finding in MECHANICS-V2 §2.3 — you cannot outrun the planet
 * westward at 32 km/h, so a long flight sees about the same number of nights
 * whenever it leaves — this makes counsel confident on short routes and silent
 * on long ones *by construction* rather than by a tuned guess.
 *
 * **F37 — dusk means the origin's dusk.** The sender's own sky, the one out
 * their window. The route-relative alternative is mechanically purer and
 * completely invisible to the person being advised.
 */

import { cellCenter, nextDawn, nextDusk } from '@smoke/shared';
import type { CellId } from '@smoke/shared';

import type { EngineContext } from '../engine/context.js';
import { planRoute } from '../routing/astar.js';
import { snapshotFrom } from '../weather/types.js';
import type { CellWeather, WeatherSnapshot } from '../weather/types.js';
import { ForecastStore, keyOf } from '../weather/forecast.js';
import { cellsAlongGreatCircle } from '@smoke/shared';

export interface CounselCandidate {
  label: 'now' | 'later' | 'dusk' | 'dawn';
  departAt: Date;
  /** Hours in the air. Null when no route exists from that departure. */
  totalHours: number | null;
  arriveAt: Date | null;
}

export interface CounselResult {
  /** The advice, in the Ledger voice. Null when counsel has nothing worth saying. */
  line: string | null;
  candidates: CounselCandidate[];
  /** Why counsel stayed quiet, for logs and tests — never shown to a player. */
  silentBecause?: 'disabled' | 'no_coverage' | 'no_route' | 'not_worth_it';
}

/**
 * The weather snapshot as it will be at `at`, built from hourly forecasts.
 *
 * A cell with no forecast row simply is not in the snapshot — which the router
 * already handles, pricing it at `routing.unknown_cost_mult` (REDTEAM F29). So
 * partial data degrades into slightly pessimistic routing rather than into a
 * wrong answer.
 */
function snapshotAt(
  cells: readonly CellId[],
  at: Date,
  hours: Map<string, { condition: string; windMph: number; windDirFromDeg: number; timeMult: number }>,
): WeatherSnapshot {
  const entries: CellWeather[] = [];
  for (const cell of cells) {
    const hour = hours.get(keyOf(cell, at));
    if (hour === undefined) continue;
    entries.push({
      cell,
      condition: hour.condition as CellWeather['condition'],
      timeMult: hour.timeMult,
      windMph: hour.windMph,
      windDirFromDeg: hour.windDirFromDeg,
      impassable: false,
      weatherUnknown: false,
      source: 'nws',
      fetchedAt: at,
    });
  }
  return snapshotFrom(entries);
}

/** Departure times worth comparing (§5.2). */
export function candidateDepartures(ctx: EngineContext, origin: CellId, now: Date): CounselCandidate[] {
  const out: CounselCandidate[] = [];
  for (const offset of ctx.config.get('counsel.candidate_offsets_hours')) {
    out.push({
      label: offset === 0 ? 'now' : 'later',
      departAt: new Date(now.getTime() + offset * 3_600_000),
      totalHours: null,
      arriveAt: null,
    });
  }

  if (ctx.config.get('counsel.include_dusk_dawn')) {
    // F37: the origin's sky, not the route's.
    const twilight = ctx.config.get('night.twilight_elevation_deg');
    const here = cellCenter(origin);
    const dusk = nextDusk(now, here, twilight);
    const dawn = nextDawn(now, here, twilight);
    if (dusk) out.push({ label: 'dusk', departAt: dusk, totalHours: null, arriveAt: null });
    if (dawn) out.push({ label: 'dawn', departAt: dawn, totalHours: null, arriveAt: null });
  }
  return out;
}

export async function counselFor(
  ctx: EngineContext,
  forecasts: ForecastStore,
  origin: CellId,
  dest: CellId,
): Promise<CounselResult> {
  if (!ctx.config.get('counsel.enabled')) {
    return { line: null, candidates: [], silentBecause: 'disabled' };
  }

  const now = ctx.clock.now();
  const candidates = candidateDepartures(ctx, origin, now);
  if (candidates.length === 0) return { line: null, candidates, silentBecause: 'no_route' };

  // The corridor we will ask about. Cheap and approximate on purpose: this is a
  // lookup key for cached forecasts, not a committed route.
  const corridor = cellsAlongGreatCircle(cellCenter(origin), cellCenter(dest));
  const last = candidates.reduce((a, b) => (a.departAt > b.departAt ? a : b));
  const horizonEnd = new Date(last.departAt.getTime() + 24 * 3_600_000);

  const hours = await forecasts.read(corridor, now, horizonEnd);

  // §5.4: counsel reads only what is cached, and would rather say nothing than
  // make anyone wait. Coverage is measured at the hour each candidate departs.
  const covered = corridor.filter((cell) => hours.has(keyOf(cell, now))).length;
  const coverage = corridor.length === 0 ? 0 : covered / corridor.length;
  if (coverage < ctx.config.get('counsel.min_forecast_coverage')) {
    return { line: null, candidates, silentBecause: 'no_coverage' };
  }

  for (const candidate of candidates) {
    const weather = snapshotAt(corridor, candidate.departAt, hours);
    const result = planRoute({ origin, dest, weather, config: ctx.config, departAt: candidate.departAt });
    if (result.status !== 'OK') continue;
    candidate.totalHours = result.totalHours;
    candidate.arriveAt = new Date(candidate.departAt.getTime() + result.totalHours * 3_600_000);
  }

  const sendNow = candidates.find((c) => c.label === 'now');
  if (!sendNow?.arriveAt || sendNow.totalHours === null) {
    return { line: null, candidates, silentBecause: 'no_route' };
  }

  const best = candidates
    .filter((c) => c.label !== 'now' && c.arriveAt !== null)
    .reduce<CounselCandidate | null>(
      (a, b) => (a === null || b.arriveAt! < a.arriveAt! ? b : a),
      null,
    );
  if (best === null) return { line: null, candidates, silentBecause: 'not_worth_it' };

  const savedMinutes = (sendNow.arriveAt.getTime() - best.arriveAt!.getTime()) / 60_000;
  const waitMinutes = (best.departAt.getTime() - now.getTime()) / 60_000;

  // F38, both halves.
  const bar = Math.max(
    ctx.config.get('counsel.min_abs_minutes'),
    ctx.config.get('counsel.min_fraction') * sendNow.totalHours * 60,
  );
  if (savedMinutes < bar) return { line: null, candidates, silentBecause: 'not_worth_it' };
  // Advice to wait four hours to arrive three hours sooner is not advice.
  if (waitMinutes >= savedMinutes) return { line: null, candidates, silentBecause: 'not_worth_it' };

  return { line: counselLine(best.label, savedMinutes), candidates };
}

/**
 * The advice, in the Ledger voice.
 *
 * Never a clock time (F37) and never a precise duration — the same reason F30
 * made the preview quote a band. Counsel that said "hold until 8:14 PM to save
 * 47 minutes" would be claiming a precision the forecast cannot support, in a
 * sentence whose whole job is to be worth glancing at.
 */
export function counselLine(label: CounselCandidate['label'], savedMinutes: number): string {
  const when =
    label === 'dusk' ? 'until dusk' : label === 'dawn' ? 'until first light' : 'a little while';
  const saved =
    savedMinutes >= 90
      ? `about ${Math.round(savedMinutes / 60)} hours sooner`
      : `about ${Math.round(savedMinutes / 15) * 15} minutes sooner`;
  return `Held ${when}, this would reach them ${saved}.`;
}
