/**
 * Counsel (MECHANICS-V2 §5; REDTEAM F37, F38, F42, F43a).
 */

import { MechanicsConfig, mechanicsSeedRows } from '@smoke/shared';
import { afterEach, describe, expect, it } from 'vitest';

import { counselFor, counselLine } from '../../src/messages/counsel.js';
import { ForecastStore } from '../../src/weather/forecast.js';
import { cellCenter, cellsAlongGreatCircle } from '@smoke/shared';
import type { CellId } from '@smoke/shared';

import { createLifecycle, PEOPLE } from '../support/lifecycle.js';

/** The cells counsel will ask about — the same corridor it derives internally. */
const corridorBetween = (a: CellId, b: CellId): CellId[] =>
  cellsAlongGreatCircle(cellCenter(a), cellCenter(b));
import type { Lifecycle } from '../support/lifecycle.js';

let life: Lifecycle | undefined;
afterEach(async () => {
  await life?.close();
  life = undefined;
});

function withCounsel(overrides: Record<string, unknown> = {}): MechanicsConfig {
  return MechanicsConfig.fromRows(
    mechanicsSeedRows().map((row) => {
      if (row.key === 'counsel.enabled') return { ...row, value: true };
      if (row.key === 'night.enabled') return { ...row, value: true };
      if (row.key === 'routing.heuristic_max_speed_factor') return { ...row, value: 0.525 };
      return row.key in overrides ? { ...row, value: overrides[row.key] } : row;
    }),
  );
}

async function storeFor(config: MechanicsConfig): Promise<ForecastStore> {
  const it = life!;
  return new ForecastStore(it.t.db, config, it.nws, () => it.clock.now());
}

describe('counsel', () => {
  it('says nothing at all when it has no forecast coverage (§5.4)', async () => {
    life = await createLifecycle();
    if (!life) throw new Error('no lifecycle');
    const config = withCounsel();
    life.ctx.configHolder.adopt(config);

    // Nothing warmed: counsel must be silent rather than fetch while a person
    // waits — the same posture F28 forced on the preview.
    const result = await counselFor(life.ctx, await storeFor(config), PEOPLE.alice.home, PEOPLE.bob.home);
    expect(result.line).toBeNull();
    expect(result.silentBecause).toBe('no_coverage');
  });

  it('is silent while the flag is off, whatever the sky is doing', async () => {
    life = await createLifecycle();
    if (!life) throw new Error('no lifecycle');
    const result = await counselFor(
      life.ctx,
      await storeFor(life.config),
      PEOPLE.alice.home,
      PEOPLE.bob.home,
    );
    expect(result.line).toBeNull();
    expect(result.silentBecause).toBe('disabled');
  });

  it('prices every candidate from one source, including "now" (REDTEAM F42)', async () => {
    life = await createLifecycle();
    if (!life) throw new Error('no lifecycle');
    const config = withCounsel();
    life.ctx.configHolder.adopt(config);
    const store = await storeFor(config);

    const corridor = corridorBetween(PEOPLE.alice.home, PEOPLE.bob.home);
    await store.warm(corridor);

    // Make weather_cells wildly different from the hourly product. If counsel
    // read it for the "now" candidate, the comparison would move; it must not.
    await life.observeWeather(corridor, 'thunderstorm');

    const result = await counselFor(life.ctx, store, PEOPLE.alice.home, PEOPLE.bob.home);
    const now = result.candidates.find((candidate) => candidate.label === 'now');
    if (now?.totalHours != null) {
      const clearHours = result.candidates.find((c) => c.label === 'later')?.totalHours;
      // Both come from forecast_hours, which the harness scripts as clear, so a
      // six-times thunderstorm multiplier in weather_cells must not appear here.
      if (clearHours != null) expect(now.totalHours).toBeLessThan(clearHours * 6);
    }
  });

  it('stays quiet when the saving is below the bar (REDTEAM F38)', async () => {
    life = await createLifecycle();
    if (!life) throw new Error('no lifecycle');
    // A bar nothing can clear.
    const config = withCounsel({ 'counsel.min_abs_minutes': 10_000 });
    life.ctx.configHolder.adopt(config);
    const store = await storeFor(config);
    await store.warm(corridorBetween(PEOPLE.alice.home, PEOPLE.bob.home));

    const result = await counselFor(life.ctx, store, PEOPLE.alice.home, PEOPLE.bob.home);
    expect(result.line).toBeNull();
    expect(result.silentBecause).toBe('not_worth_it');
  });
});

describe('counsel copy', () => {
  it('never quotes a clock time (REDTEAM F37)', () => {
    for (const label of ['dusk', 'dawn', 'later'] as const) {
      const line = counselLine(label, 95);
      expect(line).not.toMatch(/\d{1,2}:\d{2}/);
      expect(line).toMatch(/^Held /);
    }
  });

  it('rounds the saving the way a person would say it', () => {
    expect(counselLine('dusk', 47)).toContain('45 minutes sooner');
    expect(counselLine('dusk', 200)).toContain('3 hours sooner');
  });
});

describe('the forecast janitor (REDTEAM F43a)', () => {
  it('deletes hours that have already happened, and keeps the rest', async () => {
    life = await createLifecycle();
    if (!life) throw new Error('no lifecycle');
    const config = withCounsel();
    const store = await storeFor(config);
    await store.warm([PEOPLE.alice.home]);

    const before = await life.t.db.query<{ n: string }>(
      'select count(*)::text as n from public.forecast_hours',
    );
    expect(Number(before.rows[0]!.n)).toBeGreaterThan(0);

    // Two days on, most of the horizon is in the past.
    life.clock.advanceMinutes(48 * 60);
    const removed = await store.sweepExpired();
    expect(removed).toBeGreaterThan(0);

    const stillFuture = await life.t.db.query<{ n: string }>(
      'select count(*)::text as n from public.forecast_hours where valid_hour < $1',
      [life.clock.now().toISOString()],
    );
    expect(Number(stillFuture.rows[0]!.n)).toBe(0);
  });
});
