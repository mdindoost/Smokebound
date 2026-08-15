/**
 * REDTEAM F31 — the warming cron warms the right sky, and never all of it.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { runWarming } from '../../src/crons/warming.js';
import { previewMessage, sendMessage } from '../../src/messages/send.js';
import { createLifecycle, PEOPLE } from '../support/lifecycle.js';
import type { Lifecycle } from '../support/lifecycle.js';

let life: Lifecycle;
afterEach(async () => life?.close());

async function sendOne(): Promise<void> {
  const preview = await previewMessage(life.ctx, {
    senderId: PEOPLE.alice.id,
    recipientId: PEOPLE.bob.id,
    body: 'HELLO',
  });
  await sendMessage(life.ctx, {
    senderId: PEOPLE.alice.id,
    recipientId: PEOPLE.bob.id,
    body: 'HELLO',
    previewToken: preview.previewToken,
  });
}

describe('warming', () => {
  it('warms the corridor of a message in the air', async () => {
    life = await createLifecycle();
    await sendOne();

    const stats = await runWarming(life.ctx);
    expect(stats.activeRoutes).toBeGreaterThan(0);
    expect(stats.warmed).toBeGreaterThan(0);

    // The origin's own sky is the least excusable thing to be ignorant of.
    const stored = await life.store.read([PEOPLE.alice.home]);
    expect(stored.get(PEOPLE.alice.home)).toBeDefined();
  });

  it('never sweeps the whole grid, and says what it dropped', async () => {
    life = await createLifecycle();
    await sendOne();

    const stats = await runWarming(life.ctx);
    const budget = life.config.get('warming.cells_per_pass');
    expect(stats.warmed).toBeLessThanOrEqual(budget);
    // 3,444 traversable cells exist. A pass must never reach for all of them —
    // a full lap takes twice the cache TTL, so it would never finish warm.
    expect(stats.warmed).toBeLessThan(3444);
    expect(stats.skipped).toBe(Math.max(0, stats.wanted - budget));
  });

  it('does nothing expensive when nothing is happening', async () => {
    life = await createLifecycle();
    const stats = await runWarming(life.ctx);
    expect(stats.activeRoutes).toBe(0);
    expect(stats.warmed).toBe(stats.wanted);
  });
});
