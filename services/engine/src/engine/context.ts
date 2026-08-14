/**
 * Everything the lifecycle needs, passed explicitly.
 *
 * Nothing in `src/messages` or `src/crons` reaches for a global: the clock, the
 * dice, the database, the weather and the push dispatcher all arrive through
 * this object. That is what makes the whole state machine testable by
 * fast-forwarding a fake clock (ARCHITECTURE §9).
 */

import type { MechanicsConfig, Uuid } from '@smoke/shared';

import type { SqlExecutor } from '../db/executor.js';
import type { WeatherCache } from '../weather/cache.js';
import { systemClock } from './clock.js';
import type { Clock } from './clock.js';
import { systemRng } from './rng.js';
import type { Rng } from './rng.js';
import { NoopPushDispatcher } from './push.js';
import type { PushDispatcher } from './push.js';
import { assertEngineInvariants } from './guards.js';

export interface EngineContext {
  db: SqlExecutor;
  config: MechanicsConfig;
  weather: WeatherCache;
  clock: Clock;
  rng: Rng;
  push: PushDispatcher;
  log: (message: string) => void;
  /** HMAC secret for preview tokens (ARCHITECTURE §6.4). */
  previewSecret: string;
  /** Profile id of The Keeper (SPEC §3, REDTEAM F5). */
  keeperId: Uuid | null;
}

export interface CreateEngineContextOptions {
  db: SqlExecutor;
  config: MechanicsConfig;
  weather: WeatherCache;
  previewSecret: string;
  keeperId?: Uuid | null;
  clock?: Clock;
  rng?: Rng;
  push?: PushDispatcher;
  log?: (message: string) => void;
  /** Skip boot invariants. Only for tests that deliberately supply a bad config. */
  skipInvariants?: boolean;
}

export function createEngineContext(options: CreateEngineContextOptions): EngineContext {
  // Fail here rather than three hours into a beta with quietly suboptimal routes.
  if (!options.skipInvariants) assertEngineInvariants(options.config);

  if (!options.previewSecret) {
    throw new Error('previewSecret is required — preview tokens must be signed');
  }

  return {
    db: options.db,
    config: options.config,
    weather: options.weather,
    clock: options.clock ?? systemClock,
    rng: options.rng ?? systemRng,
    push: options.push ?? new NoopPushDispatcher(options.log),
    log: options.log ?? (() => {}),
    previewSecret: options.previewSecret,
    keeperId: options.keeperId ?? null,
  };
}
