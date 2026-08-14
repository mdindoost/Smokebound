/**
 * Handle rules, mirroring the schema's CHECK constraint (ARCHITECTURE §3):
 * 3–20 characters, letters, digits and underscore. Compared case-insensitively.
 *
 * Validated here so the claim screen can say what is wrong before the round
 * trip; the database is still the authority on uniqueness.
 */

export const HANDLE_MIN = 3;
export const HANDLE_MAX = 20;
const HANDLE_SHAPE = /^[A-Za-z0-9_]+$/;

export type HandleProblem =
  | { ok: true }
  | { ok: false; reason: 'empty' | 'too_short' | 'too_long' | 'bad_characters'; message: string };

export function validateHandle(raw: string): HandleProblem {
  const handle = raw.trim();

  if (handle.length === 0) {
    return { ok: false, reason: 'empty', message: 'Pick a handle.' };
  }
  if (handle.length < HANDLE_MIN) {
    return {
      ok: false,
      reason: 'too_short',
      message: `At least ${HANDLE_MIN} characters.`,
    };
  }
  if (handle.length > HANDLE_MAX) {
    return {
      ok: false,
      reason: 'too_long',
      message: `At most ${HANDLE_MAX} characters.`,
    };
  }
  if (!HANDLE_SHAPE.test(handle)) {
    return {
      ok: false,
      reason: 'bad_characters',
      message: 'Letters, numbers and underscores only.',
    };
  }
  return { ok: true };
}

/** What we store and search by. */
export function normalizeHandle(raw: string): string {
  return raw.trim();
}

/** `@alice`, for display. */
export function displayHandle(handle: string): string {
  return `@${handle}`;
}
