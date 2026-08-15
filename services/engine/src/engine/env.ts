/**
 * Reading `.env` so `npm start` just works.
 *
 * The engine takes its configuration from the environment, which is right for a
 * server — but "right for a server" should not mean that running it on your own
 * machine requires remembering `set -a && source .env && set +a` first. Node has
 * carried an env-file parser since v20.12, so this costs no dependency.
 *
 * Files are read in order and never override a variable that is already set:
 * a real environment (Fly, Railway, systemd) always wins over a file left in a
 * checkout.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));

/** `<repo>/.env` first, then `services/engine/.env` for per-service overrides. */
const CANDIDATES = [
  join(HERE, '..', '..', '..', '..', '.env'),
  join(HERE, '..', '..', '.env'),
];

let loaded = false;

export function loadEnvFiles(): string[] {
  if (loaded) return [];
  loaded = true;

  const read: string[] = [];
  for (const file of CANDIDATES) {
    if (!existsSync(file)) continue;
    try {
      process.loadEnvFile(file);
      read.push(file);
    } catch {
      // A malformed .env should not stop a server that may have everything it
      // needs from the real environment already.
    }
  }
  return read;
}

/** Read a required variable, with a message that says where to put it. */
export function requireEnv(name: string): string {
  loadEnvFiles();
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is not set.\n` +
        `Add it to .env in the repo root (copy .env.example), or export it before starting.`,
    );
  }
  return value;
}

export function optionalEnv(name: string): string | undefined {
  loadEnvFiles();
  return process.env[name];
}
