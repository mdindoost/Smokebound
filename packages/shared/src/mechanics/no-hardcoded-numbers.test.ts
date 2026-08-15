/**
 * ARCHITECTURE §10 as an executable rule:
 *
 *   "any gameplay number found hardcoded outside `mechanics_config` seeding is a bug"
 *
 * This test scans the source tree for the distinctive literals defined in
 * MECHANICS.md. `mechanics/defaults.ts` (the seeding source) and test files are
 * the only places allowed to spell them out; everywhere else must read them from
 * `mechanics_config` via `MechanicsConfig`.
 *
 * Generic values (0, 1, 2, 3, 4, 5, 10, 20, 24, 30, 50, 60 …) are deliberately
 * not scanned: they collide with array indices, timeouts and loop bounds, and a
 * guard that cries wolf gets disabled. The distinctive ones below are enough to
 * catch a copy-pasted multiplier table or garble roll, which is the real risk.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { MECHANICS_KEYS, MECHANICS_SPEC } from './defaults.js';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const REPO_ROOT = join(HERE, '..', '..', '..', '..');

/** Literals no file outside the seed may contain. */
const FORBIDDEN_EVERYWHERE = [
  '1.15', // overcast multiplier
  '1.414', // diagonal distance multiplier
  '2.5', // snow multiplier
  '4.0', // heavy rain multiplier
  '6.0', // thunderstorm multiplier
  '0.35', // garble chance in a gale
  '0.015', // headwind coefficient
  '0.03', // garble minimum fraction
  '0.05', // dissipation chance per day
];

/**
 * Additionally forbidden in server/shared code, where there is no legitimate
 * reason for these values (they double as UI opacities/margins in the client).
 */
const FORBIDDEN_IN_SERVER_CODE = [
  ...FORBIDDEN_EVERYWHERE,
  '0.7', // tailwind floor / heuristic speed factor
  '1.6', // fog multiplier, headwind ceiling
  '2.0', // light rain multiplier
  '0.01', // tailwind coefficient
  '280', // message character cap
];

const SCAN_TARGETS: { dir: string; forbidden: string[] }[] = [
  { dir: join('packages', 'shared', 'src'), forbidden: FORBIDDEN_IN_SERVER_CODE },
  { dir: join('services', 'engine', 'src'), forbidden: FORBIDDEN_IN_SERVER_CODE },
  { dir: join('apps', 'mobile'), forbidden: FORBIDDEN_EVERYWHERE },
];

const IGNORED_DIRS = new Set(['node_modules', 'dist', 'build', '.expo', '.git', 'coverage']);
const SOURCE_EXT = /\.(ts|tsx|js|jsx)$/;

/** The one file allowed to contain gameplay numbers, plus the tests that verify it. */
/**
 * The client's design layer is exempt, and this is the one exemption worth
 * arguing about.
 *
 * `apps/mobile/src/design/` holds the palette, the type scale, spacing and
 * motion — visual constants whose document is DESIGN.md, exactly as
 * `mechanics_config` is the document for anything that decides what *happens*.
 * They collide with gameplay values by coincidence and often: a 0.35 swell on a
 * breathing ember is the garble chance, a 0.05 opacity step is the dissipation
 * rate per day, a 0.015 share of the viewport is the headwind coefficient. None
 * of them change a route, an ETA or an outcome.
 *
 * The alternative was to nudge each constant to a neighbouring value until the
 * guard stopped complaining, which is how a guard gets quietly defeated instead
 * of consulted.
 *
 * The tradeoff, stated: a gameplay number hidden in `design/` would not be
 * caught. That is a narrow hole — nothing in the design layer can enact
 * gameplay, since the client renders server truth and computes none of it — and
 * a deliberately small one. It is a directory of palettes; a multiplier table
 * there would be visible to any reader.
 */
function isExempt(relPath: string): boolean {
  const parts = relPath.split(sep);
  return (
    relPath.endsWith(join('mechanics', 'defaults.ts')) ||
    /\.test\.(ts|tsx)$/.test(relPath) ||
    parts.includes('__fixtures__') ||
    relPath.startsWith(join('apps', 'mobile', 'src', 'design') + sep)
  );
}

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out; // directory not present yet (e.g. engine src before M2)
  }
  for (const entry of entries) {
    if (IGNORED_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (SOURCE_EXT.test(entry)) out.push(full);
  }
  return out;
}

/**
 * Strip comments, keeping line numbering intact.
 *
 * Doc comments quote MECHANICS.md constantly — that is the point of them — so a
 * guard that reads prose would cry wolf until someone disabled it. Only code
 * counts, which means tracking block-comment state across lines.
 */
function codeOnly(source: string): string[] {
  let inBlock = false;
  return source.split('\n').map((line) => {
    let out = '';
    for (let i = 0; i < line.length; i++) {
      if (inBlock) {
        if (line.startsWith('*/', i)) {
          inBlock = false;
          i++;
        }
        continue;
      }
      if (line.startsWith('/*', i)) {
        inBlock = true;
        i++;
        continue;
      }
      if (line.startsWith('//', i)) break;
      out += line[i];
    }
    return out;
  });
}

/**
 * Matches the literal as a standalone number, not as part of a longer one.
 *
 * The trailing guard has to refuse a decimal point followed by a digit, not just
 * a digit: without it, the sun's mean-longitude constant 280.46 reads as the
 * 280-character message cap, and the guard fails a file whose only crime is
 * astronomy. Rejecting `.\d` as well keeps the guard strict about real literals
 * while leaving longer numbers that merely start the same way alone.
 */
function literalRegex(literal: string): RegExp {
  return new RegExp(`(?<![\\w.])${literal.replace('.', '\\.')}(?![\\d]|\\.\\d)`);
}

describe('ARCHITECTURE §10: gameplay numbers live only in mechanics_config seeding', () => {
  it('finds source files to scan', () => {
    const files = SCAN_TARGETS.flatMap((t) => walk(join(REPO_ROOT, t.dir)));
    expect(files.length).toBeGreaterThan(5);
  });

  it('has no hardcoded gameplay literals outside the seed', () => {
    const violations: string[] = [];

    for (const target of SCAN_TARGETS) {
      for (const file of walk(join(REPO_ROOT, target.dir))) {
        const relPath = relative(REPO_ROOT, file);
        if (isExempt(relPath)) continue;
        const lines = codeOnly(readFileSync(file, 'utf8'));
        lines.forEach((code, i) => {
          for (const literal of target.forbidden) {
            if (literalRegex(literal).test(code)) {
              violations.push(`${relPath}:${i + 1} contains gameplay literal ${literal}`);
            }
          }
        });
      }
    }

    expect(violations).toEqual([]);
  });

  it('does not mistake a longer number for a gameplay literal', () => {
    // 280.46 is the sun's mean longitude at epoch (geo/sun.ts). It is not the
    // 280-character message cap, and a guard that cannot tell them apart would
    // teach people to add exemptions instead of reading the finding.
    expect(literalRegex('280').test('const meanLongitude = (280.46 + rate * n) % 360;')).toBe(false);
    expect(literalRegex('280').test('const cap = 280;')).toBe(true);
    expect(literalRegex('0.7').test('const mult = 0.75;')).toBe(false);
    expect(literalRegex('0.7').test('const floor = 0.7;')).toBe(true);
  });

  it('exempts the design layer and nothing broader', () => {
    // The exemption is a directory of palettes and motion tokens, not the app.
    expect(isExempt(join('apps', 'mobile', 'src', 'design', 'motion.ts'))).toBe(true);
    expect(isExempt(join('apps', 'mobile', 'src', 'map', 'SmokeTrail.tsx'))).toBe(false);
    expect(isExempt(join('apps', 'mobile', 'src', 'lib', 'wind.ts'))).toBe(false);
    expect(isExempt(join('services', 'engine', 'src', 'routing', 'cost.ts'))).toBe(false);
  });

  it('never reads a deprecated config key from computation code', () => {
    // REDTEAM F12: speed.base_kmh is canonical; the mph value is display copy.
    const deprecated = MECHANICS_KEYS.filter((k) => MECHANICS_SPEC[k].deprecated === true);
    expect(deprecated).toContain('speed.base_mph');

    const violations: string[] = [];
    for (const target of SCAN_TARGETS) {
      for (const file of walk(join(REPO_ROOT, target.dir))) {
        const relPath = relative(REPO_ROOT, file);
        // The mechanics module itself declares the key (type, validator, seed);
        // the rule is about code that *consumes* a value.
        if (isExempt(relPath) || relPath.includes(join('src', 'mechanics'))) continue;
        codeOnly(readFileSync(file, 'utf8'))
          .forEach((code, i) => {
            for (const key of deprecated) {
              if (code.includes(`'${key}'`) || code.includes(`"${key}"`)) {
                violations.push(`${relPath}:${i + 1} reads deprecated key ${key}`);
              }
            }
          });
      }
    }
    expect(violations).toEqual([]);
  });

  it('detects a violation when one is introduced (guard self-test)', () => {
    const sample = 'const mult = 1.15;';
    expect(FORBIDDEN_IN_SERVER_CODE.some((l) => literalRegex(l).test(sample))).toBe(true);
    // ...but does not fire on unrelated numbers that merely contain the digits.
    expect(FORBIDDEN_IN_SERVER_CODE.some((l) => literalRegex(l).test('const v = 21.157;'))).toBe(
      false,
    );
    expect(FORBIDDEN_IN_SERVER_CODE.some((l) => literalRegex(l).test('const port = 12800;'))).toBe(
      false,
    );
  });
});
