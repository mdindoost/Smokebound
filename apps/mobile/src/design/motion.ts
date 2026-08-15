/**
 * Motion, and the numbers that shape it (DESIGN.md R23).
 *
 * M5 ruled that "no motion" was a legitimate answer for an app about waiting,
 * and left the question open. R23 answers it for exactly one thing: the ember
 * breathes, and nothing else does. A map where the only moving object is the
 * message is a map that tells you where to look.
 *
 * Pure arithmetic, no React and no react-native import — which is also what
 * makes it testable: a module that pulls in the platform cannot be loaded by the
 * test bundler at all.
 *
 * These are **visual constants, not gameplay numbers**. They change how a circle
 * pulses and nothing else: no route, no ETA, no outcome. Their document is
 * DESIGN.md, the way `mechanics_config` is the document for anything that
 * decides what happens.
 */

/** One full breath. Slow enough to read as breathing rather than blinking. */
export const BREATH_PERIOD_MS = 3000;

/** Repaints per second while breathing. A breath does not need sixty. */
export const BREATH_FRAME_MS = 100;

/** Radius swing either side of the base, as a fraction. */
export const BREATH_SWELL = 0.35;

/** Opacity at full swell, and the extra it gains at the bottom of the breath. */
export const BREATH_ALPHA_BASE = 0.16;
export const BREATH_ALPHA_RANGE = 0.05;

/** Share of the visible span the ember occupies. */
export const EMBER_SPAN_FRACTION = 0.015;

/** Smallest radius worth drawing, in metres, when zoomed all the way in. */
export const EMBER_MIN_RADIUS_M = 1500;

/** Rough metres per degree of longitude at CONUS latitudes. */
const METRES_PER_LNG_DEG = 88_000;

export interface Breath {
  /** Multiplier on the base radius. */
  scale: number;
  /** Fill opacity. */
  alpha: number;
}

/**
 * The breath at a point in its cycle, `phase` in [0, 1).
 *
 * A sine, so there are no corners, and the slowest part of the cycle sits at
 * full swell — which is where a fire looks like it is drawing air.
 *
 * `reduceMotion` returns the still mid-breath, not a slower one. Someone who
 * asked the system to stop moving things asked for that, not for a compromise.
 */
export function emberBreathAt(phase: number, reduceMotion = false): Breath {
  if (reduceMotion) return { scale: 1, alpha: BREATH_ALPHA_BASE + BREATH_ALPHA_RANGE * 0.8 };
  const swell = Math.sin(phase * 2 * Math.PI);
  return {
    scale: 1 + BREATH_SWELL * swell,
    alpha: BREATH_ALPHA_BASE + BREATH_ALPHA_RANGE * (1 - swell),
  };
}

/**
 * A base radius that reads the same at any zoom: a small share of the view.
 *
 * Radius is in metres, so the breath scales with the map — a soft pulse across a
 * continent, a halo around a town when zoomed in. That is how a signal fire
 * actually behaves as you get further from it.
 */
export function emberRadiusFor(longitudeDeltaDeg: number | null): number {
  const span = longitudeDeltaDeg ?? 2;
  return Math.max(EMBER_MIN_RADIUS_M, span * METRES_PER_LNG_DEG * EMBER_SPAN_FRACTION);
}
