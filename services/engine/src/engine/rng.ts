/**
 * Randomness, injected and seedable.
 *
 * Garble (MECHANICS §6.2) and dissipation (§6.1) are the only dice in the game,
 * and both need to be reproducible: a support question about a mangled message
 * should be answerable, and the tests need determinism. Every roll goes through
 * this interface with a seed derived from the message it applies to.
 */

export interface Rng {
  /** Uniform in [0, 1). */
  next(): number;
}

export const systemRng: Rng = {
  next: () => Math.random(),
};

/** FNV-1a, so a message id can seed a generator. */
export function hashSeed(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** mulberry32 — small, fast, and good enough for weather drama. */
export function seededRng(seed: number | string): Rng {
  let state = (typeof seed === 'string' ? hashSeed(seed) : seed) >>> 0;
  return {
    next(): number {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
  };
}

/** A roll that succeeds with the given probability. */
export function rollChance(rng: Rng, probability: number): boolean {
  if (probability <= 0) return false;
  if (probability >= 1) return true;
  return rng.next() < probability;
}

/** Uniform sample in [min, max). */
export function uniform(rng: Rng, min: number, max: number): number {
  return min + rng.next() * (max - min);
}
