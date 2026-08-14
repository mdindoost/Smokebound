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
function isExempt(relPath: string): boolean {
  return (
    relPath.endsWith(join('mechanics', 'defaults.ts')) ||
    /\.test\.(ts|tsx)$/.test(relPath) ||
    relPath.split(sep).includes('__fixtures__')
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

/** Matches the literal as a standalone number, not as part of a longer one. */
function literalRegex(literal: string): RegExp {
  return new RegExp(`(?<![\\w.])${literal.replace('.', '\\.')}(?![\\d])`);
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
        const lines = readFileSync(file, 'utf8').split('\n');
        lines.forEach((line, i) => {
          // Comments may quote the spec; only code counts.
          const code = line.replace(/\/\/.*$/, '').replace(/\/\*.*?\*\//g, '');
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
