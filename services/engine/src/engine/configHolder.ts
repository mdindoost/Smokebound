/**
 * The live config, and the rule that a bad one never takes effect (REDTEAM F39).
 *
 * `mechanics_config` is a table an operator edits with raw SQL, and the engine
 * reads it while running. F19 already refuses to *boot* on a config whose
 * heuristic factor is optimistic — but a boot check protects nothing against an
 * `update` typed at 2 AM, which is exactly when it matters.
 *
 * Restart-required was rejected as the fix: "restart the server to change
 * config" defeats the point of having a config table at all.
 *
 * So the engine guards **adoption**, not boot. Every snapshot it loads — at
 * startup and on reload, through this one path — is validated as a *set*, and a
 * snapshot that fails is simply not adopted: the engine keeps the last good
 * config, logs loudly, and fires the dead-man alert.
 *
 * The guarantee this can and cannot give is worth being precise about. The
 * engine cannot refuse the write; it has no say in what lands in the table. It
 * can only refuse to believe it. So the promise is not *"invalid config cannot
 * exist"* but *"invalid config cannot take effect"* — and the alert is what
 * turns the second into something a human finds out about, rather than a server
 * quietly running last week's numbers.
 *
 * Practical consequence, documented in MECHANICS-V2 §6.2: a multi-key change
 * must be **one SQL transaction**. Flip `night.enabled` and the heuristic factor
 * separately and the engine may read the intermediate snapshot, correctly refuse
 * it, and keep running on the old config — so the change appears to do nothing.
 */

import { MechanicsConfig } from '@smoke/shared';

import type { SqlExecutor } from '../db/executor.js';
import { assertEngineInvariants } from './guards.js';

export type AlertChannel = (subject: string, detail: string) => void;

/**
 * Where an unadoptable config gets shouted about.
 *
 * A seam, deliberately: today it writes to stderr with a distinctive prefix so
 * it is greppable and alertable from logs; when there is a pager, it becomes a
 * pager without anything else changing.
 */
export const consoleAlert: AlertChannel = (subject, detail) => {
  console.error(`[SMOKE-ALERT] ${subject}\n${detail}`);
};

export interface AdoptionResult {
  adopted: boolean;
  /** Why it was refused, when it was. */
  problem?: string;
}

export class ConfigHolder {
  private current: MechanicsConfig;

  constructor(
    initial: MechanicsConfig,
    private readonly log: (message: string) => void = () => {},
    private readonly alert: AlertChannel = consoleAlert,
  ) {
    this.current = initial;
  }

  /** The config the engine is actually running on. Never invalid. */
  get config(): MechanicsConfig {
    return this.current;
  }

  /**
   * Validate a candidate snapshot and adopt it only if it holds together.
   *
   * Validation is over the whole snapshot, not the changed keys, because the
   * invariants are relations between keys — the heuristic factor is only wrong
   * *relative to* the multipliers it must stay under.
   */
  adopt(candidate: MechanicsConfig): AdoptionResult {
    try {
      assertEngineInvariants(candidate);
    } catch (error) {
      const problem = error instanceof Error ? error.message : String(error);
      this.alert(
        'mechanics_config was refused — the engine is running on the previous config',
        problem,
      );
      return { adopted: false, problem };
    }

    this.current = candidate;
    return { adopted: true };
  }

  /**
   * Read `mechanics_config` and adopt it if it is sound.
   *
   * A malformed table — a missing key, a value of the wrong type — is refused
   * here too, and by the same rule: the strict loader throws, and the engine
   * keeps what it had. There is no partial adoption and no per-key fallback,
   * because a config half-applied is a config nobody can reason about.
   */
  async reload(db: SqlExecutor): Promise<AdoptionResult> {
    let candidate: MechanicsConfig;
    try {
      const { rows } = await db.query<{ key: string; value: unknown }>(
        'select key, value from public.mechanics_config',
      );
      candidate = MechanicsConfig.fromRows(rows);
    } catch (error) {
      const problem = error instanceof Error ? error.message : String(error);
      this.alert('mechanics_config could not be loaded — keeping the previous config', problem);
      return { adopted: false, problem };
    }

    const result = this.adopt(candidate);
    if (result.adopted) this.log('config: reloaded and adopted');
    return result;
  }
}
