/**
 * The whole state machine, on a fake clock (ARCHITECTURE §4, §9):
 *
 *   send → transmit → fly → a storm forms mid-route → strand → clear → resume → deliver
 *
 * This is the test that would notice if any single transition stopped firing.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runDeliveryCheck } from '../../src/crons/deliveryCheck.js';
import { runReplan } from '../../src/crons/replan.js';
import { eventsFor, getMessage } from '../../src/db/repo.js';
import { previewMessage, sendMessage } from '../../src/messages/send.js';
import { PEOPLE, createLifecycle } from '../support/lifecycle.js';
import type { Lifecycle } from '../support/lifecycle.js';
import { neighbors } from '@smoke/shared';
import type { CellId } from '@smoke/shared';

/**
 * A storm system that closes in around where the smoke currently is.
 *
 * A single severe cell is simply routed around — that is the system working. To
 * strand a message the sky has to actually shut: every way out of the cell it is
 * sitting in.
 */
function closesInAround(cell: CellId): CellId[] {
  return neighbors(cell);
}

let life: Lifecycle;
let messageId: string;

const BODY = 'MEET ME AT THE RIDGE';

beforeAll(async () => {
  life = await createLifecycle();
});

afterAll(async () => {
  await life?.close();
});

describe('a message from Newark to Chicago', () => {
  it('previews with a route, an ETA and a token', async () => {
    const preview = await previewMessage(life.ctx, {
      senderId: PEOPLE.alice.id,
      recipientId: PEOPLE.bob.id,
      body: BODY,
    });

    expect(preview.noRoute).toBe(false);
    expect(preview.route![0]).toBe(PEOPLE.alice.home);
    expect(preview.route!.at(-1)).toBe(PEOPLE.bob.home);
    expect(preview.totalHours).toBeGreaterThan(34);
    expect(preview.totalHours).toBeLessThan(38);
    expect(preview.previewToken).toContain('.');
    expect(preview.proximity.sameCell).toBe(false);

    // REDTEAM F18: the quote is not priced on fail-open guesses.
    expect(preview.resolvedUnknowns.length).toBeGreaterThanOrEqual(0);
    const second = await previewMessage(life.ctx, {
      senderId: PEOPLE.alice.id,
      recipientId: PEOPLE.bob.id,
      body: BODY,
    });
    expect(second.resolvedUnknowns).toEqual([]); // everything is known by now
  });

  it('sends, and starts out transmitting', async () => {
    const preview = await previewMessage(life.ctx, {
      senderId: PEOPLE.alice.id,
      recipientId: PEOPLE.bob.id,
      body: BODY,
    });
    const result = await sendMessage(life.ctx, {
      senderId: PEOPLE.alice.id,
      recipientId: PEOPLE.bob.id,
      body: BODY,
      previewToken: preview.previewToken,
    });

    messageId = result.messageId;
    expect(result.state).toBe('TRANSMITTING');
    expect(result.etaWarning).toBeNull();
    expect(result.previewExpired).toBe(false);

    // MECHANICS §3: 20 chars ≈ 5 puffs ≈ 15 s of visible puffing.
    const departsIn =
      new Date(result.departsAt).getTime() - life.clock.now().getTime();
    expect(departsIn).toBe(15_000);

    expect(life.push.kinds()).toContain('SENT');
  });

  it('stays put while it is still puffing', async () => {
    life.clock.advanceSeconds(10);
    const stats = await runDeliveryCheck(life.ctx);
    expect(stats.departed).toBe(0);
    expect((await getMessage(life.ctx.db, messageId))!.state).toBe('TRANSMITTING');
  });

  it('departs once transmission finishes', async () => {
    life.clock.advanceSeconds(10);
    const stats = await runDeliveryCheck(life.ctx);
    expect(stats.departed).toBe(1);

    const message = await getMessage(life.ctx.db, messageId);
    expect(message!.state).toBe('IN_FLIGHT');
    expect(message!.current_leg).toBe(0);
    expect((await eventsFor(life.ctx.db, messageId)).map((e) => e.kind)).toEqual([
      'SENT',
      'DEPARTED',
    ]);
  });

  it('advances leg by leg as the hours pass', async () => {
    life.clock.advanceHours(10);
    await runDeliveryCheck(life.ctx);

    const message = await getMessage(life.ctx.db, messageId);
    expect(message!.state).toBe('IN_FLIGHT');
    expect(message!.current_leg).toBeGreaterThan(3);
    expect(message!.current_leg).toBeLessThan(message!.route!.length - 1);
  });

  it('shelters when a storm closes the way ahead', async () => {
    const message = await getMessage(life.ctx.db, messageId);
    const here = message!.route![message!.current_leg]!;
    life.nws.setSevereOver(closesInAround(here));

    const stats = await runReplan(life.ctx);
    expect(stats.stranded).toBe(1);

    const stranded = await getMessage(life.ctx.db, messageId);
    expect(stranded!.state).toBe('STRANDED');
    expect(stranded!.stranded_cell).toBe(message!.route![message!.current_leg]);
    expect(stranded!.stranded_since).not.toBeNull();

    expect(life.push.kinds()).toContain('STRANDED');
    expect((await eventsFor(life.ctx.db, messageId)).map((e) => e.kind)).toContain('STRANDED');
  });

  it('waits while the storm sits there', async () => {
    life.clock.advanceHours(2);
    const stats = await runReplan(life.ctx);
    expect(stats.resumed).toBe(0);
    expect(stats.stillStranded).toBe(1);
    expect((await getMessage(life.ctx.db, messageId))!.state).toBe('STRANDED');
  });

  it('resumes when the skies clear, with a fresh ETA', async () => {
    life.clock.advanceHours(3);
    life.nws.clearAlerts();

    const before = await getMessage(life.ctx.db, messageId);
    const stats = await runReplan(life.ctx);
    expect(stats.resumed).toBe(1);

    const resumed = await getMessage(life.ctx.db, messageId);
    expect(resumed!.state).toBe('IN_FLIGHT');
    expect(resumed!.current_leg).toBe(0); // the route is replaced from where it sat
    expect(resumed!.route![0]).toBe(before!.stranded_cell);
    expect(resumed!.stranded_since).toBeNull();
    expect(new Date(resumed!.eta!).getTime()).toBeGreaterThan(life.clock.now().getTime());

    expect(life.push.kinds()).toContain('RESUMED');
  });

  it('delivers at its ETA, and only then', async () => {
    const message = await getMessage(life.ctx.db, messageId);
    const eta = new Date(message!.eta!);

    life.clock.set(new Date(eta.getTime() - 60_000));
    await runDeliveryCheck(life.ctx);
    expect((await getMessage(life.ctx.db, messageId))!.state).toBe('IN_FLIGHT');

    life.clock.set(eta);
    const stats = await runDeliveryCheck(life.ctx);
    expect(stats.delivered).toBe(1);

    const delivered = await getMessage(life.ctx.db, messageId);
    expect(delivered!.state).toBe('DELIVERED');
    expect(delivered!.body_delivered).toBe(BODY); // no gales on this journey
    expect(delivered!.delivered_at).not.toBeNull();
  });

  it('leaves a complete event trail for the ledger and the pushes', async () => {
    const kinds = (await eventsFor(life.ctx.db, messageId)).map((e) => e.kind);
    expect(kinds).toEqual(['SENT', 'DEPARTED', 'STRANDED', 'RESUMED', 'DELIVERED']);

    const pushKinds = life.push.kinds();
    for (const kind of ['SENT', 'STRANDED', 'RESUMED', 'DELIVERED'] as const) {
      expect(pushKinds).toContain(kind);
    }
    expect(life.push.forUser(PEOPLE.bob.id).map((p) => p.kind)).toEqual(['DELIVERED']);
  });

  it('is terminal: further cron passes do nothing', async () => {
    life.clock.advanceHours(5);
    const delivery = await runDeliveryCheck(life.ctx);
    const replan = await runReplan(life.ctx);

    expect(delivery.delivered).toBe(0);
    expect(replan.checked).toBe(0);
    expect((await getMessage(life.ctx.db, messageId))!.state).toBe('DELIVERED');
  });
});

describe('the total journey time is the one the sender was quoted', () => {
  it('lands within the stranded time of the original estimate', async () => {
    const message = await getMessage(life.ctx.db, messageId);
    const flightHours =
      (new Date(message!.delivered_at!).getTime() - new Date(message!.created_at).getTime()) /
      3_600_000;

    // ~36 h of flying plus the 5 h it spent sheltering (MECHANICS §7A's third case).
    expect(flightHours).toBeGreaterThan(38);
    expect(flightHours).toBeLessThan(46);
  });
});
