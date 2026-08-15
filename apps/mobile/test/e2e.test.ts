/**
 * Two clients, one sky (ARCHITECTURE §10, M4 definition of done).
 *
 * Both sides go through the `DataGateway` the screens use, against real
 * migrations, real RLS policies and the real engine — the table transport, the
 * A* router, the crons. The config is the shipped one with a test speed
 * multiplier, so a Newark→Chicago flight takes minutes instead of a day and a
 * half.
 *
 * What this does not cover: the Supabase client library itself (the gateway
 * talks to Postgres directly here) and the React screens. Those are eyes-on
 * checks in a simulator, not something a test in this repo can honestly claim.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { EngineRequestError } from '../src/lib/engineTypes';
import { displayText, isWindDamaged } from '../src/lib/mapping';
import { ALICE, BOB, createWorld } from './support/world';
import type { World } from './support/world';

let world: World | undefined;

afterEach(async () => {
  await world?.close();
  world = undefined;
});

describe('a message from one person to another', () => {
  it('goes send → transmitting → in flight → delivered, seen from both sides', async () => {
    world = await createWorld();
    const { alice, bob, clock } = world;

    // --- Alice previews -----------------------------------------------------
    const preview = await alice.preview(BOB, 'MEET ME AT THE RIDGE');
    expect(preview.noRoute).toBe(false);
    expect(preview.route?.[0]).toBe((await alice.myProfile())!.homeCell);
    expect(preview.totalHours).toBeGreaterThan(0);
    expect(preview.proximity.sameCell).toBe(false);

    // --- Alice sends --------------------------------------------------------
    const sent = await alice.send(BOB, 'MEET ME AT THE RIDGE', preview.previewToken);
    expect(sent.state).toBe('TRANSMITTING');
    expect(sent.etaWarning).toBeNull();

    // Alice sees her own message immediately; Bob sees nothing at all.
    expect((await alice.thread(BOB)).map((m) => m.state)).toEqual(['TRANSMITTING']);
    expect(await bob.thread(ALICE)).toEqual([]);
    expect(await bob.listConversations()).toEqual([]);

    // --- it departs ---------------------------------------------------------
    clock.advanceSeconds(30);
    await world.tick();

    const inFlight = (await alice.thread(BOB))[0]!;
    expect(inFlight.state).toBe('IN_FLIGHT');
    expect(inFlight.events.map((e) => e.kind)).toEqual(['SENT', 'DEPARTED']);
    expect(await bob.thread(ALICE)).toEqual([]); // still nothing for Bob

    // --- it flies -----------------------------------------------------------
    clock.advanceMinutes(10);
    await world.tick();
    expect((await alice.thread(BOB))[0]!.state).toBe('IN_FLIGHT');

    // --- it lands -----------------------------------------------------------
    clock.advanceMinutes(60);
    await world.tick();

    const arrived = (await alice.thread(BOB))[0]!;
    expect(arrived.state).toBe('DELIVERED');
    expect(arrived.events.map((e) => e.kind)).toEqual(['SENT', 'DEPARTED', 'DELIVERED']);

    // Now — and only now — Bob has a message.
    const received = await bob.thread(ALICE);
    expect(received).toHaveLength(1);
    expect(received[0]!.direction).toBe('in');
    expect(displayText(received[0]!)).toBe('MEET ME AT THE RIDGE');

    const conversations = await bob.listConversations();
    expect(conversations).toHaveLength(1);
    expect(conversations[0]!.other.handle).toBe('alice');
    expect(conversations[0]!.lastLine).toBe('MEET ME AT THE RIDGE');
  });

  it('renders a wind-damaged delivery as damaged', async () => {
    world = await createWorld();
    const { alice, bob, clock, nws } = world;

    const body = 'HELP THE CAR BROKE DOWN OUTSIDE OF TOLEDO';
    const preview = await alice.preview(BOB, body);
    nws.setForecast(preview.route ?? [], { windSpeed: '60 mph', windDirection: 'N' });

    await alice.send(BOB, body, preview.previewToken);
    clock.advanceSeconds(30);
    await world.tick();
    clock.advanceMinutes(90);
    await world.tick();

    const delivered = (await bob.thread(ALICE))[0]!;
    expect(delivered.state).toBe('DELIVERED');
    expect(delivered.garbleCount).toBeGreaterThan(0);
    expect(isWindDamaged(delivered)).toBe(true);
    expect(displayText(delivered)).not.toBe(body);
    // Still legible: the wind takes a tenth of it at most (MECHANICS §6.2).
    expect(displayText(delivered)!.length).toBeGreaterThan(body.length * 0.8);

    // The sender's copy keeps the original, and says what happened.
    const sentCopy = (await alice.thread(BOB))[0]!;
    expect(sentCopy.body).toBe(body);
    expect(sentCopy.events.map((e) => e.kind)).toContain('GARBLED');
  });

  it('counts what is in the sky for the sender only', async () => {
    world = await createWorld();
    const { alice, bob, clock } = world;

    await alice.send(BOB, 'ONE');
    clock.advanceSeconds(30);
    await world.tick();

    const alicesLedger = await alice.listConversations();
    expect(alicesLedger[0]!.inFlight).toBe(1);
    expect(await bob.listConversations()).toEqual([]);
  });
});

describe('blocking (App Store 1.2, REDTEAM F1)', () => {
  it('stops the smoke and hides the person, without telling them', async () => {
    world = await createWorld();
    const { alice, bob, clock } = world;

    // A delivered message first, so there is a conversation to lose.
    await alice.send(BOB, 'BEFORE THE FALLING OUT');
    clock.advanceSeconds(30);
    await world.tick();
    clock.advanceMinutes(90);
    await world.tick();
    expect(await bob.thread(ALICE)).toHaveLength(1);

    // Bob blocks Alice.
    await bob.block(ALICE);

    // Alice cannot send, and is not told why.
    await expect(alice.send(BOB, 'ARE YOU THERE')).rejects.toMatchObject({
      code: 'BLOCKED',
      message: 'You can only send smoke to your flock.',
    });
    await expect(alice.preview(BOB, 'ARE YOU THERE')).rejects.toBeInstanceOf(EngineRequestError);

    // Bob cannot send either — a block cuts both ways.
    await expect(bob.send(ALICE, 'GOODBYE')).rejects.toMatchObject({ code: 'BLOCKED' });

    // Alice can no longer see Bob's profile; the flock row is gone from her view.
    const alicesFlock = await alice.listFlock();
    expect(alicesFlock.find((entry) => entry.profile.id === BOB)).toBeUndefined();

    // Bob sees the block, and can lift it.
    expect((await bob.listBlocked()).map((p) => p.id)).toEqual([ALICE]);
    await bob.unblock(ALICE);
    await expect(alice.send(BOB, 'BACK AGAIN')).resolves.toBeTruthy();
  });

  it('lets a recipient report a delivered message', async () => {
    world = await createWorld();
    const { alice, bob, clock } = world;

    await alice.send(BOB, 'SOMETHING UNPLEASANT');
    clock.advanceSeconds(30);
    await world.tick();
    clock.advanceMinutes(90);
    await world.tick();

    const message = (await bob.thread(ALICE))[0]!;
    await expect(bob.reportMessage(message.id, 'abusive')).resolves.toBeUndefined();

    const { rows } = await world.ctx.db.query<{ count: string }>(
      `select count(*)::text as count from public.reports where message_id = $1`,
      [message.id],
    );
    expect(Number(rows[0]!.count)).toBe(1);
  });
});

describe('the flock, from the client side', () => {
  it('runs a request through to an accepted friendship', async () => {
    world = await createWorld();
    const carol = '33333333-3333-4333-8333-333333333333';
    await world.db.asEngine();
    await world.ctx.db.query(`insert into auth.users (id) values ($1)`, [carol]);
    await world.ctx.db.query(
      `insert into public.profiles (id, handle, home_cell) values ($1, 'carol', 'r020c040')`,
      [carol],
    );
    const carolGateway = world.gatewayFor(carol);

    // Alice finds Carol by handle — identity only, no home cell (REDTEAM F6).
    const found = await world.alice.findByHandle('CAROL');
    expect(found).toMatchObject({ handle: 'carol' });
    expect(found!.homeCell).toBeNull();

    await world.alice.requestFlock(carol);
    expect(
      (await carolGateway.listFlock()).filter((e) => e.incoming && e.status === 'pending'),
    ).toHaveLength(1);

    // Until Carol accepts, no smoke.
    await expect(world.alice.send(carol, 'HELLO')).rejects.toMatchObject({ code: 'NOT_FLOCK' });

    await carolGateway.acceptFlock(ALICE);
    await expect(world.alice.send(carol, 'HELLO')).resolves.toBeTruthy();
  });

  it('flocks every new profile to the Keeper', async () => {
    world = await createWorld();
    const keeper = await world.alice.keeper();
    expect(keeper?.handle).toBe('thekeeper');

    const flock = await world.alice.listFlock();
    expect(flock.some((entry) => entry.profile.isSystem === true && entry.status === 'accepted')).toBe(
      true,
    );
  });

  it('delivers a Keeper message quickly and gets an answer', async () => {
    world = await createWorld();
    const keeper = (await world.alice.keeper())!;

    const preview = await world.alice.preview(keeper.id, 'HELLO FROM MY FIRE');
    expect(preview.proximity.adjacent).toBe(true);

    await world.alice.send(keeper.id, 'HELLO FROM MY FIRE', preview.previewToken);
    world.clock.advanceSeconds(30);
    await world.tick();
    world.clock.advanceMinutes(20);
    await world.tick();

    const thread = await world.alice.thread(keeper.id);
    expect(thread[0]!.state).toBe('DELIVERED');

    // The Keeper answers about half an hour later, and its reply flies back.
    world.clock.advanceMinutes(31);
    await world.tick();
    world.clock.advanceMinutes(30);
    await world.tick();

    const withReply = await world.alice.thread(keeper.id);
    expect(withReply).toHaveLength(2);
    const reply = withReply.find((m) => m.direction === 'in')!;
    expect(reply.state).toBe('DELIVERED');
    expect(displayText(reply)!.length).toBeGreaterThan(10);
  });
});

describe('what the client refuses before the engine has to', () => {
  it('surfaces the engine refusal for an over-long message', async () => {
    world = await createWorld();
    const cap = (await world.alice.mechanics()).charCap;
    await expect(world.alice.send(BOB, 'x'.repeat(cap + 1))).rejects.toMatchObject({
      code: 'BODY_TOO_LONG',
    });
  });

  it('reads the character cap from the config, never from a constant', async () => {
    world = await createWorld();
    await world.db.asEngine();
    await world.ctx.db.query(
      `update public.mechanics_config set value = '40'::jsonb where key = 'message.char_cap'`,
    );
    expect((await world.alice.mechanics()).charCap).toBe(40);
  });
});
