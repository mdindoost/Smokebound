/**
 * Phone numbers, normalised before they leave the app.
 *
 * People type numbers the way they read them — `(800) 555-0123`, `+1 800 555
 * 0123`, `1-800-555-0123` — and Supabase compares against a digits-only form.
 * A number that does not match is indistinguishable from a wrong code, which is
 * a miserable thing to debug at a sign-in screen, so the app sends one canonical
 * shape: E.164, a leading `+` and digits.
 */

/** `(800) 555-0123` → `+18005550123`. */
export function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 0) return '';
  // A bare 10-digit number is North American; anything else is assumed to
  // already carry its country code.
  const withCountry = digits.length === 10 ? `1${digits}` : digits;
  return `+${withCountry}`;
}

/** Enough of a number to be worth sending. */
export function looksLikePhone(raw: string): boolean {
  const digits = raw.replace(/\D/g, '');
  return digits.length >= 10 && digits.length <= 15;
}

/** `+18005550123` → `+1 800 555 0123`, for reading back to the user. */
export function prettyPhone(raw: string): string {
  const normalized = normalizePhone(raw);
  const match = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(normalized);
  return match ? `+1 ${match[1]} ${match[2]} ${match[3]}` : normalized;
}
