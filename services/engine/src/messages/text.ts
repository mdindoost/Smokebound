/**
 * Text mechanics: transmission time (MECHANICS §3) and garble (§6.2).
 *
 * Everything here counts **grapheme clusters**, not UTF-16 code units. The
 * script-safe rule in §6.2 is not decoration: splitting a Devanagari cluster or
 * an emoji ZWJ sequence produces mojibake, not wind damage, and the message
 * bodies are Unicode from v1 (SPEC §3 v2 note).
 */

import type { MechanicsConfig } from '@smoke/shared';

import { uniform } from '../engine/rng.js';
import type { Rng } from '../engine/rng.js';

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** Split into user-perceived characters. */
export function graphemes(text: string): string[] {
  return [...segmenter.segment(text)].map((s) => s.segment);
}

export function graphemeCount(text: string): number {
  return graphemes(text).length;
}

/**
 * Puff-by-puff transmission time (MECHANICS §3):
 * `seconds_per_puff × ceil(chars / chars_per_puff)`.
 */
export function transmissionSeconds(text: string, config: MechanicsConfig): number {
  const chars = graphemeCount(text);
  const perPuff = config.get('transmission.chars_per_puff');
  return config.get('transmission.seconds_per_puff') * Math.ceil(chars / perPuff);
}

/** What the wind leaves behind: a space, a dropped character, or a scar. */
const WIND_SWEPT = [' ', '', '~'] as const;

export interface GarbleResult {
  text: string;
  charsHit: number;
}

/**
 * Damage a message in a gale cell (MECHANICS §6.2).
 *
 * Replaces `ceil(chars × U(min, max))` whole grapheme clusters with wind-swept
 * variants, never exceeding the legibility cap. Deterministic for a given `rng`,
 * so a delivered message can always be explained.
 */
export function garbleText(text: string, rng: Rng, config: MechanicsConfig): GarbleResult {
  const clusters = graphemes(text);
  if (clusters.length === 0) return { text, charsHit: 0 };

  const fraction = uniform(
    rng,
    config.get('garble.min_fraction'),
    config.get('garble.max_fraction'),
  );
  const cap = Math.floor(clusters.length * config.get('garble.legibility_cap_fraction'));
  const wanted = Math.ceil(clusters.length * fraction);
  const count = Math.max(0, Math.min(wanted, Math.max(cap, 1), clusters.length));
  if (count === 0) return { text, charsHit: 0 };

  const targets = new Set<number>();
  // Bounded attempts: a short message with a high cap must not spin here.
  for (let attempts = 0; targets.size < count && attempts < count * 20; attempts++) {
    targets.add(Math.floor(rng.next() * clusters.length));
  }

  for (const index of targets) {
    const variant = WIND_SWEPT[Math.floor(rng.next() * WIND_SWEPT.length)] ?? '~';
    clusters[index] = variant;
  }

  return { text: clusters.join(''), charsHit: targets.size };
}
