/**
 * Counting characters the way a reader does (MECHANICS §5, REDTEAM F20).
 *
 * The compose counter has to agree with the engine's gate, or the app will
 * cheerfully let someone write 281 characters and then refuse to send them. Both
 * count grapheme clusters.
 *
 * `Intl.Segmenter` is available in Hermes on the SDK 57 runtime; the fallback
 * exists for older engines and only ever over-counts (it splits by code point),
 * which fails safe: the counter turns red early rather than late.
 */

const segmenter =
  typeof Intl !== 'undefined' && 'Segmenter' in Intl
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : null;

export function graphemes(text: string): string[] {
  if (segmenter === null) return [...text];
  return [...segmenter.segment(text)].map((entry) => entry.segment);
}

export function countGraphemes(text: string): number {
  return graphemes(text).length;
}

/** True when the message is too long to send. */
export function overCap(text: string, cap: number): boolean {
  return countGraphemes(text) > cap;
}
