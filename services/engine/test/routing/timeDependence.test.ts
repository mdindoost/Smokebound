/**
 * What time-dependence costs us, asserted rather than hidden
 * (MECHANICS-V2 §4, §7.1; REDTEAM F40, F41).
 */

import { MechanicsConfig, mechanicsSeedRows } from '@smoke/shared';
import { describe, expect, it } from 'vitest';

import { planRoute } from '../../src/routing/astar.js';
import { dijkstra } from '../reference/dijkstra.js';
import { CELLS, CONFIG, clearSky } from '../fixtures/weather.js';

function nightOn(): MechanicsConfig {
  return MechanicsConfig.fromRows(
    mechanicsSeedRows().map((row) =>
      row.key === 'night.enabled'
        ? { ...row, value: true }
        : row.key === 'routing.heuristic_max_speed_factor'
          ? { ...row, value: 0.525 }
          : row,
    ),
  );
}

describe('A* still matches Dijkstra — per frozen snapshot (§7.1)', () => {
  it('agrees exactly for a fixed departure instant', () => {
    // The equivalence claim survives time-dependence in restated form: for ONE
    // departure time, entry-time-frozen costs are an ordinary static graph, and
    // over that graph A* must still be optimal. What is no longer claimed is
    // that this optimum is the true time-dependent optimum — see below.
    const config = nightOn();
    const weather = clearSky();

    for (const iso of ['2026-08-15T18:00:00Z', '2026-08-16T04:00:00Z', '2026-08-15T23:30:00Z']) {
      const departAt = new Date(iso);
      const astar = planRoute({ origin: CELLS.newark, dest: CELLS.philadelphia, weather, config, departAt });
      const reference = dijkstra(CELLS.newark, CELLS.philadelphia, weather, config, departAt);
      if (astar.status !== 'OK' || reference.totalHours === null) throw new Error('expected routes');
      expect(astar.totalHours).toBeCloseTo(reference.totalHours, 9);
    }
  });
});

describe('the FIFO violation is real, and we do not pretend otherwise', () => {
  it('lets a later departure arrive earlier (MECHANICS-V2 §4.2)', () => {
    // The negative test §7.1 requires. Night is faster, so waiting can buy an
    // extra dark hop — leave ten minutes later, arrive earlier. No frozen-cost
    // search can see this, which is precisely why the honest label is "good
    // routes, not provably optimal" and why no copy may say "fastest".
    const config = nightOn();
    const weather = clearSky();

    const arrivalFor = (iso: string): number => {
      const departAt = new Date(iso);
      const result = planRoute({ origin: CELLS.newark, dest: CELLS.chicago, weather, config, departAt });
      if (result.status !== 'OK') throw new Error('expected a route');
      return departAt.getTime() + result.totalHours * 3_600_000;
    };

    // Sweep a day at ten-minute resolution and find any pair that overtakes.
    let violations = 0;
    let previous: number | null = null;
    for (let minute = 0; minute < 24 * 60; minute += 10) {
      const arrive = arrivalFor(new Date(Date.parse('2026-08-15T12:00:00Z') + minute * 60_000).toISOString());
      if (previous !== null && arrive < previous) violations++;
      previous = arrive;
    }

    expect(violations).toBeGreaterThan(0);
  });

  it('is bounded — waiting never buys more than the night bonus on a hop', () => {
    // Reassurance rather than a guarantee: the gap exists, but it is small, and
    // v2.1's waiting-at-towers work is deferred until beta measures how small
    // (REDTEAM F40).
    const config = nightOn();
    const weather = clearSky();
    const at = (iso: string): number => {
      const departAt = new Date(iso);
      const result = planRoute({ origin: CELLS.newark, dest: CELLS.chicago, weather, config, departAt });
      if (result.status !== 'OK') throw new Error('expected a route');
      return departAt.getTime() + result.totalHours * 3_600_000;
    };

    let worstGainMinutes = 0;
    let previous: number | null = null;
    for (let minute = 0; minute < 24 * 60; minute += 10) {
      const arrive = at(new Date(Date.parse('2026-08-15T12:00:00Z') + minute * 60_000).toISOString());
      if (previous !== null && arrive < previous) {
        worstGainMinutes = Math.max(worstGainMinutes, (previous - arrive) / 60_000);
      }
      previous = arrive;
    }

    // One hop's worth of bonus is 50 km / 32 km/h × 0.25 ≈ 23 min; allow slack
    // for diagonal hops, which are 1.414× longer.
    expect(worstGainMinutes).toBeLessThan(40);
  });
});

describe('replan correction (§7.3, REDTEAM F43b)', () => {
  /**
   * The test that earns §4.4 the right to say "replan-corrected".
   *
   * **Fixture weather is held constant throughout, and that condition is part of
   * the obligation, not an implementation detail** (REDTEAM F43b). If the sky
   * legitimately worsens mid-flight then a replan *should* return a later
   * arrival, and a test that forbade it would be asserting something false about
   * the world — and would eventually teach everyone to distrust an honest
   * failure.
   */
  it('never returns a worse arrival than the frozen plan, under a constant sky', () => {
    const config = nightOn();
    const weather = clearSky(); // constant, on purpose — see above

    for (const iso of ['2026-08-15T12:00:00Z', '2026-08-15T22:00:00Z', '2026-08-16T03:00:00Z']) {
      const departAt = new Date(iso);
      const frozen = planRoute({ origin: CELLS.newark, dest: CELLS.chicago, weather, config, departAt });
      if (frozen.status !== 'OK') throw new Error('expected a route');
      const predictedArrival = departAt.getTime() + frozen.totalHours * 3_600_000;

      // Replan from the waypoint the smoke has actually reached, on the clock it
      // actually reached it — which is what the 15-minute cron does.
      const midway = frozen.waypoints[Math.floor(frozen.waypoints.length / 2)]!;
      const at = new Date(departAt.getTime() + midway.cumulativeHours * 3_600_000);
      const replanned = planRoute({
        origin: midway.cell,
        dest: CELLS.chicago,
        weather,
        config,
        departAt: at,
      });
      if (replanned.status !== 'OK') throw new Error('expected a replan');

      const correctedArrival = at.getTime() + replanned.totalHours * 3_600_000;
      // Allow a second of floating-point slack on a multi-hour sum.
      expect(correctedArrival).toBeLessThanOrEqual(predictedArrival + 1000);
    }
  });
});
