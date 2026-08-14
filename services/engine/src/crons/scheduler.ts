/**
 * Cron scheduling (ARCHITECTURE §6.3).
 *
 * Cadences come from `mechanics_config`, not from code: delivery-check every
 * minute, replan every 15, dissipation hourly. The Keeper's reply sweep rides
 * with delivery-check — it is a database query against a handful of rows.
 *
 * Tests never use this: they call `runDeliveryCheck` and friends directly with a
 * fake clock, which is the only honest way to fast-forward 40 hours of flight.
 */

import type { EngineContext } from '../engine/context.js';
import { runDeliveryCheck } from './deliveryCheck.js';
import { runDissipation } from './dissipation.js';
import { runKeeperReplies } from './keeperReply.js';
import { runReplan } from './replan.js';

export interface CronHandle {
  stop(): void;
}

async function guarded(ctx: EngineContext, name: string, task: () => Promise<unknown>): Promise<void> {
  try {
    await task();
  } catch (err) {
    // A cron that throws must not take the process down: the next tick retries.
    ctx.log(`cron ${name} failed: ${(err as Error).message}`);
  }
}

export function startCrons(ctx: EngineContext): CronHandle {
  const minute = 60_000;
  const timers: NodeJS.Timeout[] = [];

  const every = (minutes: number, name: string, task: () => Promise<unknown>): void => {
    const timer = setInterval(() => void guarded(ctx, name, task), minutes * minute);
    timer.unref?.();
    timers.push(timer);
  };

  every(ctx.config.get('routing.delivery_check_interval_minutes'), 'delivery-check', async () => {
    await runDeliveryCheck(ctx);
    await runKeeperReplies(ctx);
  });

  every(ctx.config.get('routing.replan_interval_minutes'), 'replan', () => runReplan(ctx));

  every(ctx.config.get('routing.dissipation_check_interval_hours') * 60, 'dissipation', () =>
    runDissipation(ctx),
  );

  ctx.log('crons started: delivery-check, replan, dissipation');

  return {
    stop(): void {
      for (const timer of timers) clearInterval(timer);
    },
  };
}

/** One pass of every cron, in order. Useful for a manual sweep or a smoke test. */
export async function runAllCronsOnce(ctx: EngineContext): Promise<void> {
  await runDeliveryCheck(ctx);
  await runReplan(ctx);
  await runDissipation(ctx);
  await runKeeperReplies(ctx);
}
