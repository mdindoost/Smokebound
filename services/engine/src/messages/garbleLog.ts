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
import { garbleText, graphemes } from './text.js';

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

  // The legibility cap is a promise about the *message*, not about one gale
  // (MECHANICS §6.2). A route through a dozen gale cells rolls many times, and
  // 10% compounded a dozen times is not a wind-damaged message, it is confetti —
  // so the damage comes out of one budget for the whole flight.
  const budget = Math.max(
    1,
    Math.floor(graphemes(body).length * config.get('garble.legibility_cap_fraction')),
  );
  let spent = 0;

  for (const [index, event] of events.entries()) {
    const rng = seededRng(`${messageId}:${event.cell}:${index}`);
    const result = garbleText(text, rng, config, { maxClusters: budget - spent });
    text = result.text;
    spent += result.charsHit;
    hits.push(result.charsHit);
  }

  return { text, hits };
}
