/**
 * Replaying garble (MECHANICS §6.2).
 *
 * `messages.body` always holds the original text; `body_delivered` is produced
 * once, at delivery. In between, each gale a message survives is recorded as a
 * `garble_events` entry. Damage is therefore *derived*, not stored — replaying
 * the log from the original body with a seed built from the message id and the
 * cell gives the same text every time, so a mangled delivery can always be
 * explained after the fact.
 */

import type { MechanicsConfig, Uuid } from '@smoke/shared';

import { seededRng } from '../engine/rng.js';
import type { GarbleEventRow } from '../db/repo.js';
import { garbleText } from './text.js';

export interface GarbleReplay {
  text: string;
  /** Characters hit by each event, in order. */
  hits: number[];
}

export function replayGarbles(
  body: string,
  events: readonly GarbleEventRow[],
  messageId: Uuid,
  config: MechanicsConfig,
): GarbleReplay {
  let text = body;
  const hits: number[] = [];

  for (const [index, event] of events.entries()) {
    const rng = seededRng(`${messageId}:${event.cell}:${index}`);
    const result = garbleText(text, rng, config);
    text = result.text;
    hits.push(result.charsHit);
  }

  return { text, hits };
}
