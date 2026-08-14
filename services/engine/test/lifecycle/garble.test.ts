/**
 * Wind damage (MECHANICS §6.2).
 *
 * Two properties matter and neither is negotiable:
 *
 *  1. **Determinism.** The damage is derived from the original body and the
 *     garble log, so the same message always garbles the same way. A user asking
 *     "what did it say?" gets an answer, not a shrug.
 *  2. **Script safety.** Garbling operates on whole grapheme clusters. Splitting
 *     an emoji ZWJ sequence or a Devanagari cluster produces mojibake, not wind
 *     damage — and message bodies are Unicode from v1.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { runDeliveryCheck } from '../../src/crons/deliveryCheck.js';
import { eventsFor, getMessage } from '../../src/db/repo.js';
import { seededRng } from '../../src/engine/rng.js';
import { garbleText, graphemes } from '../../src/messages/text.js';
import { replayGarbles } from '../../src/messages/garbleLog.js';
import { sendMessage } from '../../src/messages/send.js';
import { CONFIG } from '../fixtures/weather.js';
import { PEOPLE, createLifecycle } from '../support/lifecycle.js';
import type { Lifecycle } from '../support/lifecycle.js';

const SCRIPTS: [string, string][] = [
  ['Latin', 'HELP THE CAR BROKE DOWN OUTSIDE OF TOLEDO'],
  ['Arabic', 'مرحبا كيف حالك اليوم يا صديقي العزيز'],
  ['CJK', '今日は天気がとても良いですね、山の向こうで会いましょう'],
  ['Hindi', 'नमस्ते आज मौसम बहुत अच्छा है मिलते हैं'],
  ['Emoji', '🔥🏔️👨‍👩‍👧‍👦 meet me at the ridge 🚩🇺🇸👍🏽'],
  ['Mixed', 'Café ☕ 会議 at 3pm — bring the map 🗺️'],
];

describe('garbleText', () => {
  it('is deterministic for a given seed', () => {
    for (const [, text] of SCRIPTS) {
      const a = garbleText(text, seededRng('same-seed'), CONFIG);
      const b = garbleText(text, seededRng('same-seed'), CONFIG);
      expect(a).toEqual(b);
    }
  });

  it('produces different damage from different seeds', () => {
    const text = SCRIPTS[0]![1];
    const outputs = new Set(
      ['a', 'b', 'c', 'd', 'e'].map((seed) => garbleText(text, seededRng(seed), CONFIG).text),
    );
    expect(outputs.size).toBeGreaterThan(1);
  });

  it('never damages more than the legibility cap', () => {
    const cap = CONFIG.get('garble.legibility_cap_fraction');
    for (const [name, text] of SCRIPTS) {
      for (const seed of ['1', '2', '3', '4', '5', '6', '7', '8']) {
        const result = garbleText(text, seededRng(seed), CONFIG);
        const total = graphemes(text).length;
        expect(result.charsHit, `${name}/${seed}`).toBeLessThanOrEqual(
          Math.max(1, Math.ceil(total * cap)),
        );
      }
    }
  });

  it('only ever removes whole grapheme clusters', () => {
    for (const [name, text] of SCRIPTS) {
      const original = graphemes(text);
      for (const seed of ['x', 'y', 'z']) {
        const damaged = graphemes(garbleText(text, seededRng(seed), CONFIG).text);
        const originalSet = new Set(original);
        for (const cluster of damaged) {
          const allowed = originalSet.has(cluster) || [' ', '~'].includes(cluster);
          expect(allowed, `${name}: unexpected cluster ${JSON.stringify(cluster)}`).toBe(true);
        }
      }
    }
  });

  it('leaves no lone surrogates or broken sequences', () => {
    for (const [name, text] of SCRIPTS) {
      for (const seed of ['p', 'q', 'r', 's']) {
        const damaged = garbleText(text, seededRng(seed), CONFIG).text;
        expect(damaged, name).toBe(damaged.normalize('NFC').normalize());
        expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(damaged), name).toBe(false);
        expect(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(damaged), name).toBe(false);
        // A joined family emoji is either intact or gone, never half-eaten.
        expect(damaged.startsWith('‍')).toBe(false);
        expect(damaged.endsWith('‍')).toBe(false);
      }
    }
  });

  it('keeps a message recognisable', () => {
    const text = SCRIPTS[0]![1];
    const damaged = garbleText(text, seededRng('legible'), CONFIG).text;
    const before = graphemes(text);
    const after = graphemes(damaged);
    const survivors = after.filter((c) => before.includes(c)).length;
    expect(survivors / before.length).toBeGreaterThan(0.85);
  });

  it('handles an empty or single-character body without throwing', () => {
    expect(garbleText('', seededRng('e'), CONFIG)).toEqual({ text: '', charsHit: 0 });
    expect(garbleText('a', seededRng('e'), CONFIG).text.length).toBeLessThanOrEqual(1);
  });
});

describe('replayGarbles', () => {
  it('rebuilds the same damaged text from the log every time', () => {
    const body = SCRIPTS[0]![1];
    const events = [
      { cell: 'r038c084', at: '2026-08-14T13:00:00.000Z', chars_hit: 0 },
      { cell: 'r039c080', at: '2026-08-14T18:00:00.000Z', chars_hit: 0 },
    ];
    const first = replayGarbles(body, events, 'message-1', CONFIG);
    const second = replayGarbles(body, events, 'message-1', CONFIG);

    expect(first).toEqual(second);
    expect(first.hits).toHaveLength(2);
    expect(first.text).not.toBe(body);
  });

  it('depends on the message id, so two messages garble differently', () => {
    const body = SCRIPTS[0]![1];
    const events = [{ cell: 'r038c084', at: '2026-08-14T13:00:00.000Z', chars_hit: 0 }];
    expect(replayGarbles(body, events, 'message-1', CONFIG).text).not.toBe(
      replayGarbles(body, events, 'message-2', CONFIG).text,
    );
  });

  it('is the identity with no events', () => {
    expect(replayGarbles('UNTOUCHED', [], 'm', CONFIG)).toEqual({ text: 'UNTOUCHED', hits: [] });
  });
});

describe('gale cells damage a message in flight (MECHANICS §2.2)', () => {
  let life: Lifecycle | undefined;

  afterEach(async () => {
    await life?.close();
    life = undefined;
  });

  it('rolls garble in a gale and delivers wind-damaged text', async () => {
    life = await createLifecycle();
    const body = SCRIPTS[0]![1];

    const sent = await sendMessage(life.ctx, {
      senderId: PEOPLE.alice.id,
      recipientId: PEOPLE.bob.id,
      body,
    });

    // A gale over the whole route: every traversal rolls (35% each).
    const message = await getMessage(life.ctx.db, sent.messageId);
    life.nws.setGale(message!.route!, 55);

    life.clock.advanceMinutes(2);
    await runDeliveryCheck(life.ctx);
    life.clock.advanceHours(40);
    const stats = await runDeliveryCheck(life.ctx);

    expect(stats.delivered).toBe(1);
    expect(stats.garbled).toBeGreaterThan(0);

    const delivered = await getMessage(life.ctx.db, sent.messageId);
    expect(delivered!.state).toBe('DELIVERED');
    expect(delivered!.body).toBe(body); // the original is kept
    expect(delivered!.body_delivered).not.toBe(body); // what arrived is not
    expect((delivered!.garble_events as unknown[]).length).toBeGreaterThan(0);

    const events = await eventsFor(life.ctx.db, sent.messageId);
    expect(events.map((e) => e.kind)).toContain('GARBLED');
    expect(life.push.forUser(PEOPLE.bob.id)[0]!.body).toMatch(/wind-damaged/);
  });

  it('leaves a calm-weather message untouched', async () => {
    life = await createLifecycle();
    const body = 'CALM SKIES ALL THE WAY';

    const sent = await sendMessage(life.ctx, {
      senderId: PEOPLE.alice.id,
      recipientId: PEOPLE.bob.id,
      body,
    });
    life.clock.advanceMinutes(2);
    await runDeliveryCheck(life.ctx);
    life.clock.advanceHours(40);
    await runDeliveryCheck(life.ctx);

    const delivered = await getMessage(life.ctx.db, sent.messageId);
    expect(delivered!.body_delivered).toBe(body);
    expect(delivered!.garble_events).toEqual([]);
  });

  it('does not roll below the gale threshold', async () => {
    life = await createLifecycle();
    const sent = await sendMessage(life.ctx, {
      senderId: PEOPLE.alice.id,
      recipientId: PEOPLE.bob.id,
      body: 'BREEZY BUT FINE',
    });
    const message = await getMessage(life.ctx.db, sent.messageId);
    // Just under the threshold: a stiff wind, not a gale.
    life.nws.setGale(message!.route!, CONFIG.get('wind.gale_threshold_mph') - 1);

    life.clock.advanceMinutes(2);
    await runDeliveryCheck(life.ctx);
    life.clock.advanceHours(40);
    const stats = await runDeliveryCheck(life.ctx);

    expect(stats.garbled).toBe(0);
    expect((await getMessage(life.ctx.db, sent.messageId))!.body_delivered).toBe('BREEZY BUT FINE');
  });
});
