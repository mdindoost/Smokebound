/**
 * Subset EB Garamond to what the app can actually draw.
 *
 *   npm run fonts:subset --workspace apps/mobile
 *
 * `@expo-google-fonts/eb-garamond` ships 490 KB per weight, and the app uses
 * two. Nearly all of that is coverage we cannot use: EB Garamond carries Greek,
 * Cyrillic, extensive Latin Extended, and a large set of typographic
 * alternates, and a messaging app for CONUS draws a fraction of it.
 *
 * **This loses nothing that worked before.** MECHANICS §5 makes any script a
 * legal message, and that already relies on system fallback for anything EB
 * Garamond does not cover — it has no Devanagari, no Arabic, no CJK, no emoji.
 * Dropping Greek and Cyrillic moves those two scripts from "rendered in a serif
 * the user did not choose" to "rendered in the system font, like every other
 * non-Latin script already is". Consistent, and much smaller.
 *
 * The subset is deliberately generous within Latin: full Latin-1 Supplement and
 * Latin Extended-A, so names with accents — Ñ, ø, ł, ő — keep the serif they
 * are written in everywhere else in the app. A message from someone called
 * Šimon should not change typeface.
 *
 * Output lands in `assets/fonts/` and is committed, because a build step that
 * must run before the app renders is a build step that will one day not run.
 */

import { readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import subsetFont from 'subset-font';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, '..', 'assets', 'fonts');

/**
 * The characters worth carrying.
 *
 * Expressed as ranges rather than a scrape of the source, because the app draws
 * user-written text: a subset built from today's copy would break on the first
 * message containing a character nobody had typed yet.
 */
const RANGES = [
  [0x0020, 0x007e], // Basic Latin
  [0x00a0, 0x00ff], // Latin-1 Supplement — accented Western European
  [0x0100, 0x017f], // Latin Extended-A — Central/Eastern European
  [0x2010, 0x2027], // dashes, quotes, ellipsis
  [0x2030, 0x205e], // per-mille, primes, bullet
  [0x20a0, 0x20bf], // currency
  [0x2190, 0x2193], // arrows — used in route summaries
  [0x2022, 0x2022], // bullet (in the Ledger's separators)
];

const TEXT = RANGES.flatMap(([lo, hi]) =>
  Array.from({ length: hi - lo + 1 }, (_, i) => String.fromCodePoint(lo + i)),
).join('');

const FONTS = [
  ['400Regular', 'EBGaramond_400Regular'],
  ['600SemiBold', 'EBGaramond_600SemiBold'],
];

mkdirSync(OUT_DIR, { recursive: true });

let before = 0;
let after = 0;

for (const [dir, name] of FONTS) {
  const source = join(
    HERE, '..', '..', '..', 'node_modules', '@expo-google-fonts', 'eb-garamond', dir, `${name}.ttf`,
  );
  const original = readFileSync(source);
  const subset = await subsetFont(original, TEXT, { targetFormat: 'truetype' });

  const target = join(OUT_DIR, `${name}.ttf`);
  writeFileSync(target, subset);

  before += original.length;
  after += subset.length;
  const drop = Math.round((1 - subset.length / original.length) * 100);
  console.log(
    `  ${name.padEnd(28)} ${kb(original.length)} → ${kb(subset.length)}  (−${drop}%)`,
  );
}

console.log(`\n  total ${kb(before)} → ${kb(after)}  (−${Math.round((1 - after / before) * 100)}%)`);
console.log(`  written to ${OUT_DIR}`);

function kb(bytes) {
  return `${(bytes / 1024).toFixed(0)} KB`.padStart(7);
}
