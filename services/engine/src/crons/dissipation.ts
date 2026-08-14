/**
 * dissipation — hourly (ARCHITECTURE §6.3, MECHANICS §6.1).
 *
 * The only way a message dies. After 24 h continuously stranded it starts
 * rolling against a 5%/day dissipation chance; v1 has no other loss (MECHANICS
 * §6.3 — every failure is weather-caused and inspectable on the map, which is
 * the fairness story).
 *
 * The config states the chance **per day** while the cron runs hourly, so the
 * per-run probability is converted rather than applied raw:
 *
 *   p_run = 1 − (1 − p_day)^(run_interval_hours / 24)
 *
 * That way the observed daily loss rate matches the configured number no matter
 * how often the cron is scheduled — changing the cadence must not change the
 * game.
 */

import type { MechanicsConfig } from '@smoke/shared';

import { hoursBetween } from '../engine/clock.js';
import type { EngineContext } from '../engine/context.js';
import { rollChance } from '../engine/rng.js';
import { messagesInStates, recordEvent, updateMessage } from '../db/repo.js';

export interface DissipationStats {
  eligible: number;
  lost: number;
}

/** Per-run dissipation probability implied by the per-day config value. */
export function perRunDissipationChance(config: MechanicsConfig): number {
  const perDay = config.get('stranded.dissipation_chance_per_day');
  const intervalHours = config.get('routing.dissipation_check_interval_hours');
  if (perDay <= 0) return 0;
  if (perDay >= 1) return 1;
  return 1 - Math.pow(1 - perDay, intervalHours / 24);
}

export async function runDissipation(ctx: EngineContext): Promise<DissipationStats> {
  const now = ctx.clock.now();
  const graceHours = ctx.config.get('stranded.grace_hours');
  const chance = perRunDissipationChance(ctx.config);
  const stats: DissipationStats = { eligible: 0, lost: 0 };

  for (const message of await messagesInStates(ctx.db, ['STRANDED'])) {
    if (message.stranded_since === null) continue;
    const strandedFor = hoursBetween(new Date(message.stranded_since), now);
    if (strandedFor < graceHours) continue; // no loss from stranding alone for 24 h

    stats.eligible++;
    if (!rollChance(ctx.rng, chance)) continue;

    const cell = message.stranded_cell ?? message.origin_cell;
    await updateMessage(ctx.db, message.id, {
      state: 'LOST',
      lostAt: now,
      lostCell: cell,
      lostReason: 'dissipated',
    });
    await recordEvent(ctx.db, message.id, 'LOST', {
      cell,
      reason: 'dissipated',
      stranded_hours: strandedFor,
    });
    await ctx.push.dispatch({
      userId: message.sender,
      kind: 'LOST',
      title: 'The sky took this one',
      body: `Your signal dissipated after ${Math.round(strandedFor)} hours of waiting.`,
      data: { message_id: message.id, cell, stranded_hours: strandedFor },
    });
    stats.lost++;
  }

  return stats;
}
