/**
 * Testing the night without waiting for it (M5.7 §5).
 *
 * The night chain, the fire marker, the terminator and the night copy are all
 * driven by the sun, which means testing them on a device meant standing around
 * until dusk. That is a poor loop for a feature whose bugs have twice been
 * "looks fine, is wrong".
 *
 * So in development the sun's clock — **and only the sun's clock** — can be
 * shifted:
 *
 *     EXPO_PUBLIC_SUN_OFFSET_HOURS=8   npm run start:tunnel -w apps/mobile
 *
 * Eight hours forward from an afternoon puts you in the small hours without
 * touching anything else.
 *
 * **Two guards, and both matter.**
 *
 * 1. `__DEV__`. In a production build this function returns its argument
 *    unchanged before it looks at anything, so the override cannot be reached
 *    even if the variable is somehow present. A test-only affordance that ships
 *    is not a test-only affordance.
 * 2. **Only the sun.** ETAs, progress, event timestamps and the Ledger keep the
 *    real clock. Shifting time globally would make a flight appear to arrive
 *    eight hours early, and a debug tool that lies about delivery is worse than
 *    no debug tool — it would send someone hunting a bug that does not exist.
 *
 * What it changes is what the sky *looks* like, not what the engine believes.
 * The engine has its own flags (`night.enabled`) and its own clock; this cannot
 * reach either.
 */

/** True only in a development bundle. */
function isDev(): boolean {
  return typeof __DEV__ !== 'undefined' && __DEV__ === true;
}

function offsetHours(): number {
  const raw = process.env['EXPO_PUBLIC_SUN_OFFSET_HOURS'];
  if (raw === undefined || raw === '') return 0;
  const hours = Number(raw);
  return Number.isFinite(hours) ? hours : 0;
}

/**
 * The instant to ask the sun about.
 *
 * Identical to `real` everywhere except a development build with the override
 * set. Every sun call site in the app goes through here, so there is one place
 * to look when the sky is doing something unexpected.
 */
export function sunNow(real: Date): Date {
  if (!isDev()) return real;
  const hours = offsetHours();
  if (hours === 0) return real;
  return new Date(real.getTime() + hours * 3_600_000);
}

/** Whether the sky is currently being faked, for a visible dev-only banner. */
export function sunOverrideHours(): number | null {
  if (!isDev()) return null;
  const hours = offsetHours();
  return hours === 0 ? null : hours;
}
