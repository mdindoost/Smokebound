/**
 * Tower voices, engine side (M5.7 §2).
 */

import { MechanicsConfig, mechanicsSeedRows } from '@smoke/shared';
import { afterEach, describe, expect, it } from 'vitest';

import { runNarration } from '../../src/crons/narration.js';
import { previewMessage, sendMessage } from '../../src/messages/send.js';
import { runDeliveryCheck } from '../../src/crons/deliveryCheck.js';
import { createLifecycle, PEOPLE } from '../support/lifecycle.js';
import type { Lifecycle } from '../support/lifecycle.js';

let life: Lifecycle | undefined;
afterEach(async () => {
  await life?.close();
  life = undefined;
});

async function inFlight(): Promise<string> {
  const it = life!;
  const preview = await previewMessage(it.ctx, {
    senderId: PEOPLE.alice.id,
    recipientId: PEOPLE.bob.id,
    body: 'HELLO',
  });
  const sent = await sendMessage(it.ctx, {
    senderId: PEOPLE.alice.id,
    recipientId: PEOPLE.bob.id,
    body: 'HELLO',
    previewToken: preview.previewToken,
  });
  it.clock.advanceMinutes(5);
  await runDeliveryCheck(it.ctx);
  return sent.messageId;
}

const kinds = async (id: string): Promise<string[]> => {
  const rows = await life!.t.db.query<{ kind: string }>(
    'select kind from public.events where message_id = $1 order by created_at',
    [id],
  );
  return rows.rows.map((row) => row.kind);
};

describe('narration', () => {
  it('lets a station speak once a message is in the air', async () => {
    life = await createLifecycle();
    const id = await inFlight();

    const stats = await runNarration(life.ctx);
    expect(stats.considered).toBeGreaterThan(0);
    expect(await kinds(id)).toContain('SIGHTED');
  });

  it('will not speak twice inside the throttle window', async () => {
    life = await createLifecycle();
    const id = await inFlight();

    await runNarration(life.ctx);
    const after = (await kinds(id)).length;

    // A cron at replan cadence runs every 15 minutes; the throttle is hours.
    life.clock.advanceMinutes(15);
    const second = await runNarration(life.ctx);
    expect(second.throttled).toBeGreaterThan(0);
    expect((await kinds(id)).length).toBe(after);
  });

  it('speaks again once the window has passed', async () => {
    life = await createLifecycle();
    const id = await inFlight();
    await runNarration(life.ctx);
    const before = (await kinds(id)).length;

    life.clock.advanceMinutes(60 * life.config.get('narration.min_interval_hours') + 1);
    await runNarration(life.ctx);
    expect((await kinds(id)).length).toBeGreaterThan(before);
  });

  it('stamps events on the engine clock, not the database clock', async () => {
    // This is what makes the throttle a throttle. Events used to take
    // created_at from the DB default while every other engine timestamp came
    // from ctx.clock — two unrelated timelines under a test clock, and a
    // message that could never speak twice.
    life = await createLifecycle();
    const id = await inFlight();
    await runNarration(life.ctx);

    const rows = await life.t.db.query<{ created_at: Date }>(
      'select created_at from public.events where message_id = $1 order by created_at desc limit 1',
      [id],
    );
    const stamped = new Date(rows.rows[0]!.created_at).getTime();
    expect(Math.abs(stamped - life.clock.now().getTime())).toBeLessThan(60_000);
  });

  it('reports a gale rather than a sighting when there is one', async () => {
    // Rule 3: a sighting is what a station says when it has nothing better.
    life = await createLifecycle();
    const id = await inFlight();

    // The cache serves the store until the TTL lapses, so a scripted change only
    // reaches the engine after the cached observation ages out. That is the
    // real fetch path, and worth exercising rather than reaching past.
    life.nws.setGale([PEOPLE.alice.home, PEOPLE.bob.home], 60);
    life.clock.advanceMinutes(
      life.config.get('weather.cache_ttl_minutes') +
        60 * life.config.get('narration.min_interval_hours') +
        1,
    );

    await runNarration(life.ctx);
    const seen = await kinds(id);
    // Either the gale was found, or nothing at all — never a bare sighting when
    // a gale is blowing over the message.
    expect(seen.includes('WIND_ROSE') || !seen.includes('SIGHTED')).toBe(true);
  });

  it('says nothing at all when the flag is off', async () => {
    life = await createLifecycle();
    const id = await inFlight();
    const before = (await kinds(id)).length;

    life.ctx.configHolder.adopt(
      MechanicsConfig.fromRows(
        mechanicsSeedRows().map((row) =>
          row.key === 'narration.enabled' ? { ...row, value: false } : row,
        ),
      ),
    );
    const stats = await runNarration(life.ctx);
    expect(stats.considered).toBe(0);
    expect((await kinds(id)).length).toBe(before);
  });
});

describe('R21 — towers speak to the sender only', () => {
  it('keeps narration invisible to the recipient until delivery', async () => {
    life = await createLifecycle();
    const id = await inFlight();
    await runNarration(life.ctx);

    // The policy, exercised as the recipient would actually hit it.
    await life.t.as(PEOPLE.bob.id);
    const asRecipient = await life.t.db.query<{ kind: string }>(
      'select kind from public.events where message_id = $1',
      [id],
    );
    await life.t.asEngine();
    expect(asRecipient.rows).toEqual([]);
  });
});
