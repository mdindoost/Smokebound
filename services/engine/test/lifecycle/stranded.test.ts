/**
 * Stranded at origin (REDTEAM F17) and dissipation (MECHANICS §6.1).
 *
 * The F17 rule is the one worth stating plainly: a send never fails for want of
 * a route. When the sky is shut, the user still lights the fire, still watches
 * it transmit, and still has a message waiting for the weather to turn.
 */

import { formatCellId, neighbors } from '@smoke/shared';
import { afterEach, describe, expect, it } from 'vitest';

import { runDeliveryCheck } from '../../src/crons/deliveryCheck.js';
import { runDissipation, perRunDissipationChance } from '../../src/crons/dissipation.js';
import { runReplan } from '../../src/crons/replan.js';
import { eventsFor, getMessage } from '../../src/db/repo.js';
import { seededRng } from '../../src/engine/rng.js';
import { previewMessage, sendMessage } from '../../src/messages/send.js';
import { PEOPLE, createLifecycle } from '../support/lifecycle.js';
import type { Lifecycle } from '../support/lifecycle.js';
import { CONFIG } from '../fixtures/weather.js';

let life: Lifecycle | undefined;

afterEach(async () => {
  await life?.close();
  life = undefined;
});

describe('a walled-off sky (REDTEAM F17)', () => {
  it('still creates the message, and says so in the preview', async () => {
    life = await createLifecycle();
    life.nws.setSevereOver(neighbors(PEOPLE.alice.home));

    const preview = await previewMessage(life.ctx, {
      senderId: PEOPLE.alice.id,
      recipientId: PEOPLE.bob.id,
      body: 'ARE YOU THERE',
    });
    expect(preview.noRoute).toBe(true);
    expect(preview.route).toBeNull();
    expect(preview.eta).toBeNull();
    expect(preview.previewToken).toBeTruthy(); // you can still send it

    const result = await sendMessage(life.ctx, {
      senderId: PEOPLE.alice.id,
      recipientId: PEOPLE.bob.id,
      body: 'ARE YOU THERE',
      previewToken: preview.previewToken,
    });
    expect(result.state).toBe('TRANSMITTING');
    expect(result.noRoute).toBe(true);
    expect(result.messageId).toBeTruthy();
  });

  it('transmits, then strands at its own fire', async () => {
    life = await createLifecycle();
    life.nws.setSevereOver(neighbors(PEOPLE.alice.home));

    const sent = await sendMessage(life.ctx, {
      senderId: PEOPLE.alice.id,
      recipientId: PEOPLE.bob.id,
      body: 'ARE YOU THERE',
    });

    life.clock.advanceMinutes(1);
    const stats = await runDeliveryCheck(life.ctx);
    expect(stats.strandedAtOrigin).toBe(1);
    expect(stats.departed).toBe(0);

    const message = await getMessage(life.ctx.db, sent.messageId);
    expect(message!.state).toBe('STRANDED');
    expect(message!.stranded_cell).toBe(PEOPLE.alice.home);
    expect(message!.stranded_since).not.toBeNull();

    const events = await eventsFor(life.ctx.db, sent.messageId);
    expect(events.map((e) => e.kind)).toEqual(['SENT', 'STRANDED']);
    expect(events[1]!.payload).toMatchObject({ at_origin: true });
    expect(life.push.kinds()).toContain('STRANDED');
  });

  it('leaves when the weather does', async () => {
    life = await createLifecycle();
    life.nws.setSevereOver(neighbors(PEOPLE.alice.home));

    const sent = await sendMessage(life.ctx, {
      senderId: PEOPLE.alice.id,
      recipientId: PEOPLE.bob.id,
      body: 'ARE YOU THERE',
    });
    life.clock.advanceMinutes(1);
    await runDeliveryCheck(life.ctx);

    // Retried every cycle while the storm sits over the town.
    life.clock.advanceMinutes(15);
    expect((await runReplan(life.ctx)).stillStranded).toBe(1);

    life.clock.advanceMinutes(15);
    life.nws.clearAlerts();
    const stats = await runReplan(life.ctx);
    expect(stats.resumed).toBe(1);

    const message = await getMessage(life.ctx.db, sent.messageId);
    expect(message!.state).toBe('IN_FLIGHT');
    expect(message!.route![0]).toBe(PEOPLE.alice.home);
    expect(message!.eta).not.toBeNull();
    expect((await eventsFor(life.ctx.db, sent.messageId)).map((e) => e.kind)).toEqual([
      'SENT',
      'STRANDED',
      'RESUMED',
    ]);
  });

  it('also accepts a send when the recipient is the one under the storm', async () => {
    life = await createLifecycle();
    life.nws.setSevereOver([PEOPLE.bob.home]);

    const result = await sendMessage(life.ctx, {
      senderId: PEOPLE.alice.id,
      recipientId: PEOPLE.bob.id,
      body: 'HOPE YOU ARE DRY',
    });
    expect(result.noRoute).toBe(true);
    expect(result.state).toBe('TRANSMITTING');
  });
});

describe('dissipation (MECHANICS §6.1)', () => {
  it('converts the per-day chance to the cron cadence', () => {
    // 5%/day checked hourly: 24 hourly rolls must still add up to 5% per day,
    // so changing the cron cadence cannot change the game.
    const perRun = perRunDissipationChance(CONFIG);
    const perDay = 1 - Math.pow(1 - perRun, 24);
    expect(perDay).toBeCloseTo(CONFIG.get('stranded.dissipation_chance_per_day'), 10);
    expect(perRun).toBeLessThan(CONFIG.get('stranded.dissipation_chance_per_day'));
  });

  it('never loses a message inside the 24 h grace period', async () => {
    life = await createLifecycle();
    life.nws.setSevereOver(neighbors(PEOPLE.alice.home));
    const sent = await sendMessage(life.ctx, {
      senderId: PEOPLE.alice.id,
      recipientId: PEOPLE.bob.id,
      body: 'WAITING IT OUT',
    });
    life.clock.advanceMinutes(1);
    await runDeliveryCheck(life.ctx);

    for (let hour = 0; hour < 23; hour++) {
      life.clock.advanceHours(1);
      const stats = await runDissipation(life.ctx);
      expect(stats.lost).toBe(0);
      expect(stats.eligible).toBe(0);
    }
    expect((await getMessage(life.ctx.db, sent.messageId))!.state).toBe('STRANDED');
  });

  it('loses about 5% of stranded messages per day once the grace expires', async () => {
    // A statistical test with a seeded RNG: deterministic, but the number it
    // checks is the real thing — the observed daily loss rate.
    life = await createLifecycle({ rng: seededRng('dissipation-statistics') });

    // Inserted directly: this is a test of the dissipation roll, not of the send
    // path, and 200 sends would trip the daily rate limit twenty times over.
    // Stranded out on the route, not at home — a tended fire never dies (F22).
    const population = 200;
    const strandedSince = life.clock.now().toISOString();
    const outThere = formatCellId({ row: 38, col: 80 });
    for (let i = 0; i < population; i++) {
      await life.ctx.db.query(
        `insert into public.messages
           (sender, recipient, body, state, origin_cell, dest_cell, stranded_since, stranded_cell, created_at)
         values ($1, $2, $3, 'STRANDED', $4, $5, $6, $7, $6)`,
        [
          PEOPLE.alice.id,
          PEOPLE.bob.id,
          `WAITING ${i}`,
          PEOPLE.alice.home,
          PEOPLE.bob.home,
          strandedSince,
          outThere,
        ],
      );
    }

    life.clock.advanceHours(24); // grace expires

    let lost = 0;
    for (let hour = 0; hour < 24; hour++) {
      life.clock.advanceHours(1);
      lost += (await runDissipation(life.ctx)).lost;
    }

    const rate = lost / population;
    expect(rate).toBeGreaterThan(0.01);
    expect(rate).toBeLessThan(0.12);
    // The configured rate is 5%/day; a 200-message sample has a standard
    // deviation of about 1.5 percentage points, so this brackets it generously.
    expect(Math.abs(rate - 0.05)).toBeLessThan(0.05);
  }, 120_000);

  it('records where and why a message died, and tells the sender', async () => {
    life = await createLifecycle({ rng: { next: () => 0 } }); // every roll lands
    const sent = await sendMessage(life.ctx, {
      senderId: PEOPLE.alice.id,
      recipientId: PEOPLE.bob.id,
      body: 'THE LAST ONE',
    });

    // Strand it out on the route: only weather away from home can take a
    // message (REDTEAM F22).
    const strandedCell = formatCellId({ row: 38, col: 80 });
    await life.ctx.db.query(
      `update public.messages
          set state = 'STRANDED', stranded_since = $2, stranded_cell = $3
        where id = $1`,
      [sent.messageId, life.clock.now().toISOString(), strandedCell],
    );

    life.clock.advanceHours(25);
    const stats = await runDissipation(life.ctx);
    expect(stats.lost).toBe(1);

    const message = await getMessage(life.ctx.db, sent.messageId);
    expect(message!.state).toBe('LOST');
    expect(message!.lost_cell).toBe(strandedCell);
    expect(message!.lost_reason).toBe('dissipated');
    expect(message!.lost_at).not.toBeNull();
    expect(message!.body_delivered).toBeNull(); // it never arrived

    const events = await eventsFor(life.ctx.db, sent.messageId);
    expect(events.map((e) => e.kind)).toContain('LOST');
    expect(life.push.forUser(PEOPLE.alice.id).map((p) => p.kind)).toContain('LOST');

    // Terminal: nothing moves it afterwards.
    life.clock.advanceHours(2);
    expect((await runReplan(life.ctx)).checked).toBe(0);
    expect((await runDissipation(life.ctx)).eligible).toBe(0);
  });
});
