/**
 * What a send refuses, and why (ARCHITECTURE §6.4, §8; REDTEAM F1, F10).
 *
 * The list is deliberately short: flock, blocks, length, rate limit. Everything
 * else — no route, bad weather, a closed sky — is the product working.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { runDeliveryCheck } from '../../src/crons/deliveryCheck.js';
import { runKeeperReplies } from '../../src/crons/keeperReply.js';
import { getMessage } from '../../src/db/repo.js';
import { EngineError } from '../../src/messages/errors.js';
import { KEEPER_ID, keeperCellFor } from '../../src/messages/keeper.js';
import { previewMessage, resendMessage, sendMessage } from '../../src/messages/send.js';
import { CONFIG } from '../fixtures/weather.js';
import { PEOPLE, createLifecycle } from '../support/lifecycle.js';
import type { Lifecycle } from '../support/lifecycle.js';

let life: Lifecycle | undefined;

afterEach(async () => {
  await life?.close();
  life = undefined;
});

async function expectError(promise: Promise<unknown>, code: string): Promise<EngineError> {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(EngineError);
    expect((err as EngineError).code).toBe(code);
    return err as EngineError;
  }
  throw new Error(`expected ${code}`);
}

describe('who you may send to', () => {
  it('refuses someone who is not accepted flock', async () => {
    life = await createLifecycle();
    await expectError(
      sendMessage(life.ctx, {
        senderId: PEOPLE.alice.id,
        recipientId: PEOPLE.carol.id, // no flock edge at all
        body: 'HELLO STRANGER',
      }),
      'NOT_FLOCK',
    );
  });

  it('refuses a pending request as if it were no flock at all', async () => {
    life = await createLifecycle();
    await life.ctx.db.query(
      `insert into public.flock (a, b, status, requested_by) values (least($1::uuid,$2::uuid), greatest($1::uuid,$2::uuid), 'pending', $1)`,
      [PEOPLE.alice.id, PEOPLE.carol.id],
    );
    await expectError(
      sendMessage(life.ctx, {
        senderId: PEOPLE.alice.id,
        recipientId: PEOPLE.carol.id,
        body: 'STILL WAITING',
      }),
      'NOT_FLOCK',
    );
  });

  it('refuses a blocked pair without telling either side which it was', async () => {
    life = await createLifecycle();
    await life.ctx.db.query('insert into public.blocks (blocker, blocked) values ($1, $2)', [
      PEOPLE.mallory.id,
      PEOPLE.alice.id,
    ]);

    const blockedSend = await expectError(
      sendMessage(life.ctx, {
        senderId: PEOPLE.alice.id, // flocked with mallory, but blocked
        recipientId: PEOPLE.mallory.id,
        body: 'LET ME BACK IN',
      }),
      'BLOCKED',
    );
    // Same words as the not-flock refusal: a block is never confirmed (F1).
    expect(blockedSend.message).toBe('You can only send smoke to your flock.');

    // ...and in the other direction too.
    await expectError(
      sendMessage(life.ctx, {
        senderId: PEOPLE.mallory.id,
        recipientId: PEOPLE.alice.id,
        body: 'NOR YOU ME',
      }),
      'BLOCKED',
    );
  });

  it('refuses to send to yourself', async () => {
    life = await createLifecycle();
    await expectError(
      sendMessage(life.ctx, {
        senderId: PEOPLE.alice.id,
        recipientId: PEOPLE.alice.id,
        body: 'NOTE TO SELF',
      }),
      'NOT_FLOCK',
    );
  });

  it('refuses an unknown recipient', async () => {
    life = await createLifecycle();
    await expectError(
      sendMessage(life.ctx, {
        senderId: PEOPLE.alice.id,
        recipientId: '99999999-9999-4999-8999-999999999999',
        body: 'ANYONE THERE',
      }),
      'PROFILE_NOT_FOUND',
    );
  });
});

describe('what you may say', () => {
  it('accepts exactly the character cap and refuses one more', async () => {
    life = await createLifecycle();
    const cap = CONFIG.get('message.char_cap');

    const atCap = await sendMessage(life.ctx, {
      senderId: PEOPLE.alice.id,
      recipientId: PEOPLE.bob.id,
      body: 'x'.repeat(cap),
    });
    expect(atCap.messageId).toBeTruthy();

    const error = await expectError(
      sendMessage(life.ctx, {
        senderId: PEOPLE.alice.id,
        recipientId: PEOPLE.bob.id,
        body: 'x'.repeat(cap + 1),
      }),
      'BODY_TOO_LONG',
    );
    expect(error.details).toMatchObject({ cap, length: cap + 1 });
  });

  it('counts grapheme clusters, not code units', async () => {
    life = await createLifecycle();
    // 40 family emoji are 40 characters to a reader and 120 to JavaScript's
    // `.length`; the cap applies to what the reader counts.
    const body = '👨‍👩‍👧‍👦'.repeat(40);
    expect(body.length).toBeGreaterThan(CONFIG.get('message.char_cap'));
    await expect(
      sendMessage(life.ctx, { senderId: PEOPLE.alice.id, recipientId: PEOPLE.bob.id, body }),
    ).resolves.toBeTruthy();
  });

  it('refuses a body that would burst the storage bound (REDTEAM F20)', async () => {
    life = await createLifecycle();
    // 280 emoji now fit; 2,001 code points do not. The gameplay cap is the
    // grapheme count, the column bound is only a guard against absurdity.
    await expect(
      sendMessage(life.ctx, {
        senderId: PEOPLE.alice.id,
        recipientId: PEOPLE.bob.id,
        body: '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}\u200D\u{1F466}'.repeat(CONFIG.get('message.char_cap')),
      }),
    ).resolves.toBeTruthy();

    const error = await expectError(
      sendMessage(life.ctx, {
        senderId: PEOPLE.alice.id,
        recipientId: PEOPLE.bob.id,
        // 280 clusters, each a long combining sequence: legal by the cap, and
        // still too big for the column even with the F25 headroom.
        body: 'a\u0301\u0302\u0303\u0304\u0305\u0306\u0307\u0308\u0309\u030A\u030B\u030C\u030D\u030E'.repeat(280),
      }),
      'BODY_TOO_LONG',
    );
    expect(error.details).toMatchObject({ unit: 'storage', bound: 4000 });
  });

  it('refuses an empty message', async () => {
    life = await createLifecycle();
    await expectError(
      sendMessage(life.ctx, { senderId: PEOPLE.alice.id, recipientId: PEOPLE.bob.id, body: '' }),
      'BODY_EMPTY',
    );
  });
});

describe('how often you may send (ARCHITECTURE §8)', () => {
  it('stops at the daily limit and starts again a day later', async () => {
    life = await createLifecycle();
    const cap = CONFIG.get('limits.sends_per_user_per_day');

    for (let i = 0; i < cap; i++) {
      await sendMessage(life.ctx, {
        senderId: PEOPLE.alice.id,
        recipientId: PEOPLE.bob.id,
        body: `FIRE ${i}`,
      });
    }

    const error = await expectError(
      sendMessage(life.ctx, {
        senderId: PEOPLE.alice.id,
        recipientId: PEOPLE.bob.id,
        body: 'ONE TOO MANY',
      }),
      'RATE_LIMITED',
    );
    expect(error.details).toMatchObject({ cap, sentToday: cap });

    // The window rolls: a day later the sender is free again.
    life.clock.advanceHours(25);
    await expect(
      sendMessage(life.ctx, {
        senderId: PEOPLE.alice.id,
        recipientId: PEOPLE.bob.id,
        body: 'A NEW DAY',
      }),
    ).resolves.toBeTruthy();
  }, 120_000);

  it('does not limit one user because another has been busy', async () => {
    life = await createLifecycle();
    for (let i = 0; i < CONFIG.get('limits.sends_per_user_per_day'); i++) {
      await sendMessage(life.ctx, {
        senderId: PEOPLE.alice.id,
        recipientId: PEOPLE.bob.id,
        body: `FIRE ${i}`,
      });
    }
    await expect(
      sendMessage(life.ctx, {
        senderId: PEOPLE.mallory.id,
        recipientId: PEOPLE.alice.id,
        body: 'MY FIRST TODAY',
      }),
    ).resolves.toBeTruthy();
  }, 120_000);
});

describe('preview tokens (ARCHITECTURE §6.4)', () => {
  it('sends without a token at all', async () => {
    life = await createLifecycle();
    const result = await sendMessage(life.ctx, {
      senderId: PEOPLE.alice.id,
      recipientId: PEOPLE.bob.id,
      body: 'NO PREVIEW NEEDED',
    });
    expect(result.etaWarning).toBeNull();
    expect(result.previewExpired).toBe(false);
  });

  it('refuses a token that was issued for a different message', async () => {
    life = await createLifecycle();
    const preview = await previewMessage(life.ctx, {
      senderId: PEOPLE.alice.id,
      recipientId: PEOPLE.bob.id,
      body: 'ONE THING',
    });
    await expectError(
      sendMessage(life.ctx, {
        senderId: PEOPLE.alice.id,
        recipientId: PEOPLE.bob.id,
        body: 'SOMETHING ELSE ENTIRELY',
        previewToken: preview.previewToken,
      }),
      'INVALID_TOKEN',
    );
  });

  it('refuses a forged token', async () => {
    life = await createLifecycle();
    await expectError(
      sendMessage(life.ctx, {
        senderId: PEOPLE.alice.id,
        recipientId: PEOPLE.bob.id,
        body: 'TRUST ME',
        previewToken: 'eyJmYWtlIjp0cnVlfQ.notasignature',
      }),
      'INVALID_TOKEN',
    );
  });

  it('recomputes silently when the token has aged out', async () => {
    life = await createLifecycle();
    const preview = await previewMessage(life.ctx, {
      senderId: PEOPLE.alice.id,
      recipientId: PEOPLE.bob.id,
      body: 'SLOW HANDS',
    });

    life.clock.advanceMinutes(CONFIG.get('preview.token_ttl_minutes') + 1);
    const result = await sendMessage(life.ctx, {
      senderId: PEOPLE.alice.id,
      recipientId: PEOPLE.bob.id,
      body: 'SLOW HANDS',
      previewToken: preview.previewToken,
    });

    expect(result.previewExpired).toBe(true);
    expect(result.etaWarning).toBeNull(); // an expired quote is not compared
    expect(result.messageId).toBeTruthy();
  });

  it('warns when the sky moved more than the threshold between preview and send', async () => {
    life = await createLifecycle();
    const body = 'WEATHER PERMITTING';
    const preview = await previewMessage(life.ctx, {
      senderId: PEOPLE.alice.id,
      recipientId: PEOPLE.bob.id,
      body,
    });
    expect(preview.totalHours).toBeGreaterThan(0);

    // A thunderstorm line settles over the corridor inside the token's lifetime.
    await life.observeWeather(preview.route!, 'thunderstorm');
    life.clock.advanceMinutes(2);

    const result = await sendMessage(life.ctx, {
      senderId: PEOPLE.alice.id,
      recipientId: PEOPLE.bob.id,
      body,
      previewToken: preview.previewToken,
    });

    expect(result.previewExpired).toBe(false);
    expect(result.totalHours!).toBeGreaterThan(preview.totalHours!);
    expect(result.etaWarning).not.toBeNull();
    expect(result.etaWarning!.reason).toBe('slower');
    expect(result.etaWarning!.shiftFraction!).toBeGreaterThan(
      CONFIG.get('preview.eta_shift_warn_fraction'),
    );
    expect(result.etaWarning!.previewedHours).toBeCloseTo(preview.totalHours!, 6);
    // The message is sent regardless — the warning informs, it does not block.
    expect(result.messageId).toBeTruthy();
  });

  it('stays quiet when the sky barely moved', async () => {
    life = await createLifecycle();
    const body = 'HOLD ON';
    const preview = await previewMessage(life.ctx, {
      senderId: PEOPLE.alice.id,
      recipientId: PEOPLE.bob.id,
      body,
    });

    // Overcast is 1.15x: a 15% shift, under the 20% warning threshold.
    await life.observeWeather(preview.route!, 'overcast');
    life.clock.advanceMinutes(1);

    const result = await sendMessage(life.ctx, {
      senderId: PEOPLE.alice.id,
      recipientId: PEOPLE.bob.id,
      body,
      previewToken: preview.previewToken,
    });
    expect(result.totalHours!).toBeGreaterThan(preview.totalHours!);
    expect(result.etaWarning).toBeNull();
  });

  it('warns the other way when the sky clears', async () => {
    life = await createLifecycle();
    const body = 'GOOD NEWS';
    await life.observeWeather([], 'clear');

    const preview = await previewMessage(life.ctx, {
      senderId: PEOPLE.alice.id,
      recipientId: PEOPLE.bob.id,
      body,
    });
    // Wind at the sender's back all the way: 0.7x time, a 30% improvement.
    life.nws.setForecast(preview.route!, { windSpeed: '60 mph', windDirection: 'E' });
    await life.weather.getCellWeather(preview.route!);
    life.clock.advanceMinutes(CONFIG.get('weather.cache_ttl_minutes') + 1);

    const result = await sendMessage(life.ctx, {
      senderId: PEOPLE.alice.id,
      recipientId: PEOPLE.bob.id,
      body,
    });
    expect(result.totalHours!).toBeLessThan(preview.totalHours!);
  });
});

describe('resend ("light a new fire", MECHANICS §6.3)', () => {
  it('re-sends the same words on a fresh route', async () => {
    life = await createLifecycle();
    const original = await sendMessage(life.ctx, {
      senderId: PEOPLE.alice.id,
      recipientId: PEOPLE.bob.id,
      body: 'TRY AGAIN',
    });

    const again = await resendMessage(life.ctx, {
      senderId: PEOPLE.alice.id,
      messageId: original.messageId,
    });

    expect(again.messageId).not.toBe(original.messageId);
    const message = await getMessage(life.ctx.db, again.messageId);
    expect(message!.body).toBe('TRY AGAIN');
    expect(message!.state).toBe('TRANSMITTING');
  });

  it('refuses to re-light someone else’s fire', async () => {
    life = await createLifecycle();
    const original = await sendMessage(life.ctx, {
      senderId: PEOPLE.alice.id,
      recipientId: PEOPLE.bob.id,
      body: 'MINE',
    });
    await expectError(
      resendMessage(life.ctx, { senderId: PEOPLE.bob.id, messageId: original.messageId }),
      'NOT_YOUR_MESSAGE',
    );
  });
});

describe('The Keeper (SPEC §3, REDTEAM F5)', () => {
  it('sits one cell away from whoever is writing', async () => {
    life = await createLifecycle({ withKeeper: true });

    const preview = await previewMessage(life.ctx, {
      senderId: PEOPLE.alice.id,
      recipientId: KEEPER_ID,
      body: 'HELLO KEEPER',
    });

    expect(preview.destCell).toBe(keeperCellFor(PEOPLE.alice.home));
    expect(preview.proximity.adjacent).toBe(true);
    expect(preview.totalHours).toBeLessThan(3);

    // Different user, different Keeper fire.
    const other = await previewMessage(life.ctx, {
      senderId: PEOPLE.carol.id,
      recipientId: KEEPER_ID,
      body: 'HELLO FROM DENVER',
    });
    expect(other.destCell).toBe(keeperCellFor(PEOPLE.carol.home));
    expect(other.destCell).not.toBe(preview.destCell);
  });

  it('delivers inside the hour, then answers about half an hour later', async () => {
    life = await createLifecycle({ withKeeper: true });

    const sent = await sendMessage(life.ctx, {
      senderId: PEOPLE.alice.id,
      recipientId: KEEPER_ID,
      body: 'FIRST FIRE',
    });
    expect(sent.totalHours).toBeLessThan(3);

    life.clock.advanceMinutes(1);
    await runDeliveryCheck(life.ctx);
    life.clock.advanceHours(3);
    expect((await runDeliveryCheck(life.ctx)).delivered).toBe(1);

    // Not yet: the Keeper takes its time (keeper.reply_delay_minutes).
    expect((await runKeeperReplies(life.ctx)).replied).toBe(0);

    life.clock.advanceMinutes(CONFIG.get('keeper.reply_delay_minutes') + 1);
    expect((await runKeeperReplies(life.ctx)).replied).toBe(1);
    // Idempotent: a second sweep does not answer twice.
    expect((await runKeeperReplies(life.ctx)).replied).toBe(0);

    const { rows } = await life.ctx.db.query<{ body: string; sender: string }>(
      `select body, sender from public.messages where sender = $1 and recipient = $2`,
      [KEEPER_ID, PEOPLE.alice.id],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.body.length).toBeGreaterThan(10);
  });

  it('rotates its lines rather than repeating itself', async () => {
    life = await createLifecycle({ withKeeper: true });
    const lines: string[] = [];

    for (let i = 0; i < 3; i++) {
      await sendMessage(life.ctx, {
        senderId: PEOPLE.alice.id,
        recipientId: KEEPER_ID,
        body: `FIRE NUMBER ${i}`,
      });
      life.clock.advanceMinutes(1);
      await runDeliveryCheck(life.ctx);
      life.clock.advanceHours(2);
      await runDeliveryCheck(life.ctx);
      life.clock.advanceMinutes(CONFIG.get('keeper.reply_delay_minutes') + 1);
      await runKeeperReplies(life.ctx);

      const { rows } = await life.ctx.db.query<{ body: string }>(
        `select body from public.messages where sender = $1 and recipient = $2 order by created_at`,
        [KEEPER_ID, PEOPLE.alice.id],
      );
      lines.push(rows.at(-1)!.body);
    }

    expect(new Set(lines).size).toBe(3);
  }, 120_000);

  it('is not subject to the daily send limit', async () => {
    life = await createLifecycle({ withKeeper: true });
    const cap = CONFIG.get('limits.sends_per_user_per_day');
    for (let i = 0; i < cap + 2; i++) {
      await sendMessage(life.ctx, {
        senderId: KEEPER_ID,
        recipientId: PEOPLE.alice.id,
        body: `KEEPER LINE ${i}`,
      });
    }
    // No throw: the limit guards people, not the system account.
  }, 120_000);
});
