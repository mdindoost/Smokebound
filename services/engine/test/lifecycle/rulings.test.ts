/**
 * The M3 review rulings, as tests (REDTEAM F20, F22, F23).
 */

import { neighbors } from '@smoke/shared';
import { afterEach, describe, expect, it } from 'vitest';

import { runDeliveryCheck } from '../../src/crons/deliveryCheck.js';
import { runDissipation } from '../../src/crons/dissipation.js';
import { runReplan } from '../../src/crons/replan.js';
import { getMessage } from '../../src/db/repo.js';
import { NwsUnavailableError } from '../../src/weather/nws.js';
import { sendMessage } from '../../src/messages/send.js';
import { graphemeCount } from '../../src/messages/text.js';
import { CONFIG } from '../fixtures/weather.js';
import { PEOPLE, createLifecycle } from '../support/lifecycle.js';
import type { Lifecycle } from '../support/lifecycle.js';

let life: Lifecycle | undefined;

afterEach(async () => {
  await life?.close();
  life = undefined;
});

describe('F20: grapheme clusters are the cap, storage is just a bound', () => {
  it('accepts 280 emoji — 1,960 code points — because a reader counts 280', async () => {
    life = await createLifecycle();
    const cap = CONFIG.get('message.char_cap');
    const body = '👨‍👩‍👧‍👦'.repeat(cap);

    expect(graphemeCount(body)).toBe(cap);
    expect([...body].length).toBeGreaterThan(cap * 5);

    const sent = await sendMessage(life.ctx, {
      senderId: PEOPLE.alice.id,
      recipientId: PEOPLE.bob.id,
      body,
    });
    const stored = await getMessage(life.ctx.db, sent.messageId);
    expect(stored!.body).toBe(body);
  });

  it('still refuses 281 of them', async () => {
    life = await createLifecycle();
    const body = '👨‍👩‍👧‍👦'.repeat(CONFIG.get('message.char_cap') + 1);
    await expect(
      sendMessage(life.ctx, { senderId: PEOPLE.alice.id, recipientId: PEOPLE.bob.id, body }),
    ).rejects.toThrow(/characters/);
  });

  it('charges by clusters, so no script pays extra for its diacritics', async () => {
    life = await createLifecycle();
    const devanagari = 'क्षत्रियाणाम';
    const clusters = graphemeCount(devanagari);
    // The whole point: this word is far longer in code points than in characters.
    expect(clusters).toBeLessThan([...devanagari].length);

    const latin = 'x'.repeat(clusters);
    const sentDevanagari = await sendMessage(life.ctx, {
      senderId: PEOPLE.alice.id,
      recipientId: PEOPLE.bob.id,
      body: devanagari,
    });
    const sentLatin = await sendMessage(life.ctx, {
      senderId: PEOPLE.alice.id,
      recipientId: PEOPLE.bob.id,
      body: latin,
    });

    const transmissionOf = async (id: string): Promise<number> => {
      const message = await getMessage(life!.ctx.db, id);
      return new Date(message!.departed_at!).getTime() - new Date(message!.created_at).getTime();
    };

    const expected =
      CONFIG.get('transmission.seconds_per_puff') *
      Math.ceil(clusters / CONFIG.get('transmission.chars_per_puff')) *
      1000;

    expect(await transmissionOf(sentDevanagari.messageId)).toBe(expected);
    expect(await transmissionOf(sentLatin.messageId)).toBe(expected);
  });
});

describe('F22: a tended fire never dies', () => {
  it('never dissipates a message stranded at its own origin', async () => {
    life = await createLifecycle({ rng: { next: () => 0 } }); // every roll would land
    life.nws.setSevereOver(neighbors(PEOPLE.alice.home));

    const sent = await sendMessage(life.ctx, {
      senderId: PEOPLE.alice.id,
      recipientId: PEOPLE.bob.id,
      body: 'WAITING AT HOME',
    });
    life.clock.advanceMinutes(1);
    await runDeliveryCheck(life.ctx);

    const stranded = await getMessage(life.ctx.db, sent.messageId);
    expect(stranded!.stranded_cell).toBe(stranded!.origin_cell);

    // A week of storms, with the dice rigged against it.
    for (let day = 0; day < 7; day++) {
      for (let hour = 0; hour < 24; hour++) {
        life.clock.advanceHours(1);
        const stats = await runDissipation(life.ctx);
        expect(stats.lost).toBe(0);
      }
    }

    const survivor = await getMessage(life.ctx.db, sent.messageId);
    expect(survivor!.state).toBe('STRANDED');
    expect(life.push.kinds()).not.toContain('LOST');
  }, 120_000);

  it('counts tended fires separately from ones out in the weather', async () => {
    life = await createLifecycle({ rng: { next: () => 1 } }); // no roll ever lands
    const strandedSince = life.clock.now().toISOString();

    // One at home, one out on the route.
    await life.ctx.db.query(
      `insert into public.messages
         (sender, recipient, body, state, origin_cell, dest_cell, stranded_since, stranded_cell, created_at)
       values ($1, $2, 'AT HOME', 'STRANDED', $3, $4, $5, $3, $5),
              ($1, $2, 'OUT THERE', 'STRANDED', $3, $4, $5, $4, $5)`,
      [PEOPLE.alice.id, PEOPLE.bob.id, PEOPLE.alice.home, PEOPLE.bob.home, strandedSince],
    );

    life.clock.advanceHours(CONFIG.get('stranded.grace_hours') + 1);
    const stats = await runDissipation(life.ctx);

    expect(stats.tended).toBe(1);
    expect(stats.eligible).toBe(1);
  });

  it('does dissipate once the message has actually left home', async () => {
    life = await createLifecycle({ rng: { next: () => 0 } });
    const strandedSince = life.clock.now().toISOString();
    await life.ctx.db.query(
      `insert into public.messages
         (sender, recipient, body, state, origin_cell, dest_cell, stranded_since, stranded_cell, created_at)
       values ($1, $2, 'OUT THERE', 'STRANDED', $3, $4, $5, $4, $5)`,
      [PEOPLE.alice.id, PEOPLE.bob.id, PEOPLE.alice.home, PEOPLE.bob.home, strandedSince],
    );

    life.clock.advanceHours(CONFIG.get('stranded.grace_hours') + 1);
    const stats = await runDissipation(life.ctx);
    expect(stats.lost).toBe(1);
    expect(stats.tended).toBe(0);
  });

  it('an origin-stranded message still resumes when the sky opens', async () => {
    life = await createLifecycle();
    life.nws.setSevereOver(neighbors(PEOPLE.alice.home));
    const sent = await sendMessage(life.ctx, {
      senderId: PEOPLE.alice.id,
      recipientId: PEOPLE.bob.id,
      body: 'PATIENT',
    });
    life.clock.advanceMinutes(1);
    await runDeliveryCheck(life.ctx);

    life.clock.advanceHours(48); // long past the grace period
    await runDissipation(life.ctx);
    life.nws.clearAlerts();
    expect((await runReplan(life.ctx)).resumed).toBe(1);
    expect((await getMessage(life.ctx.db, sent.messageId))!.state).toBe('IN_FLIGHT');
  });
});

describe('F23: an alerts outage is visible, not silent', () => {
  it('reports how stale the alert list is', async () => {
    life = await createLifecycle();
    await life.weather.getCellWeather([PEOPLE.alice.home]);
    expect(life.weather.lastStats.alertStalenessMinutes).toBe(0);
  });

  it('reports null staleness when the sky is un-walled by an outage', async () => {
    life = await createLifecycle();
    life.nws.getActiveAlerts = async () => {
      throw new NwsUnavailableError('alerts down', 503);
    };

    const snapshot = await life.weather.getCellWeather([PEOPLE.alice.home]);
    expect(snapshot.get(PEOPLE.alice.home)!.impassable).toBe(false); // fail-open stands
    expect(life.weather.lastStats.alertStalenessMinutes).toBeNull();
  });

  it('reports the age of the last usable list during a brief outage', async () => {
    life = await createLifecycle();
    life.nws.setSevereOver([PEOPLE.bob.home]);
    await life.weather.getCellWeather([PEOPLE.bob.home]);
    expect(life.weather.lastStats.alertStalenessMinutes).toBe(0);

    life.nws.getActiveAlerts = async () => {
      throw new NwsUnavailableError('alerts down', 503);
    };
    life.clock.advanceMinutes(20);

    const snapshot = await life.weather.getCellWeather([PEOPLE.bob.home]);
    expect(snapshot.get(PEOPLE.bob.home)!.impassable).toBe(true); // still walled, from stale data
    expect(life.weather.lastStats.alertStalenessMinutes).toBe(20);
  });
});
