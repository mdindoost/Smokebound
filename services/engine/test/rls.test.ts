/**
 * RLS behaviour, asserted the way an attacker would probe it: sign in as each
 * party and check what actually comes back.
 *
 * The rules under test (ARCHITECTURE §3):
 *  - profiles readable by flock members only
 *  - messages readable by sender + recipient only, and the body reaches the
 *    recipient only once state = 'DELIVERED'
 *  - blocks are invisible to the person blocked
 *  - clients never write flight state; that is the engine's job
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createFlock, createTestDatabase, createUser } from './harness.js';
import type { TestDatabase } from './harness.js';

const ALICE = '11111111-1111-4111-8111-111111111111';
const BOB = '22222222-2222-4222-8222-222222222222';
const CAROL = '33333333-3333-4333-8333-333333333333';
const MALLORY = '44444444-4444-4444-8444-444444444444';
const KEEPER = '55555555-5555-4555-8555-555555555555';

let t: TestDatabase;

beforeAll(async () => {
  t = await createTestDatabase();
  await t.migrate();

  await createUser(t, ALICE, 'alice', 'r037c090'); // Newark
  await createUser(t, BOB, 'bob', 'r039c066'); // Chicago
  await createUser(t, CAROL, 'carol', 'r020c040');
  await createUser(t, MALLORY, 'mallory', 'r010c010');
  await createUser(t, KEEPER, 'thekeeper', 'r037c089');

  await createFlock(t, ALICE, BOB, 'accepted', ALICE);
  await createFlock(t, ALICE, KEEPER, 'accepted', KEEPER);
  await createFlock(t, ALICE, CAROL, 'pending', CAROL);
  // Mallory blocked Alice; Alice does not know.
  await t.asEngine();
  await t.db.query('insert into public.blocks (blocker, blocked) values ($1, $2)', [
    MALLORY,
    ALICE,
  ]);
});

afterAll(async () => {
  await t?.close();
});

async function selectAs<Row = Record<string, unknown>>(
  userId: string | null,
  sql: string,
  params: unknown[] = [],
  role: 'authenticated' | 'anon' = 'authenticated',
): Promise<Row[]> {
  await t.as(userId, role);
  const { rows } = await t.db.query<Row>(sql, params);
  return rows;
}

describe('profiles: readable by flock only', () => {
  it('lets a user see their own profile', async () => {
    const rows = await selectAs<{ handle: string }>(
      ALICE,
      'select handle from public.profiles where id = $1',
      [ALICE],
    );
    expect(rows.map((r) => r.handle)).toEqual(['alice']);
  });

  it('shows accepted and pending flock members, and nobody else', async () => {
    const rows = await selectAs<{ handle: string }>(
      ALICE,
      'select handle from public.profiles order by handle',
    );
    expect(rows.map((r) => r.handle).sort()).toEqual(['alice', 'bob', 'carol', 'thekeeper']);
  });

  it('hides a stranger entirely', async () => {
    const rows = await selectAs(BOB, 'select handle from public.profiles where id = $1', [CAROL]);
    expect(rows).toHaveLength(0);
  });

  it('hides the profile of someone who blocked you, even mid-flock', async () => {
    // Give Mallory and Alice a flock edge; the block must still win.
    await createFlock(t, ALICE, MALLORY, 'accepted', ALICE);
    const rows = await selectAs(ALICE, 'select handle from public.profiles where id = $1', [
      MALLORY,
    ]);
    expect(rows).toHaveLength(0);
    await t.asEngine();
    await t.db.query('delete from public.flock where a in ($1, $2) and b in ($1, $2)', [
      ALICE,
      MALLORY,
    ]);
  });

  it('lets nobody read profiles without a session', async () => {
    await expect(selectAs(null, 'select handle from public.profiles', [], 'anon')).rejects.toThrow(
      /permission denied/i,
    );
  });

  it('refuses to let a user rewrite someone else’s profile', async () => {
    await t.as(ALICE);
    const { rows } = await t.db.query(
      "update public.profiles set display_name = 'pwned' where id = $1 returning id",
      [BOB],
    );
    expect(rows).toHaveLength(0);
  });

  it('lets a user move their own fire', async () => {
    await t.as(ALICE);
    const { rows } = await t.db.query(
      "update public.profiles set home_cell = 'r037c091' where id = $1 returning home_cell",
      [ALICE],
    );
    expect(rows).toHaveLength(1);
    await t.db.query("update public.profiles set home_cell = 'r037c090' where id = $1", [ALICE]);
  });

  it('exposes handle lookup without leaking home_cell (REDTEAM F6)', async () => {
    await t.as(CAROL);
    const { rows } = await t.db.query<{ id: string; handle: string }>(
      'select * from public.find_profile_by_handle($1)',
      ['BOB'], // case-insensitive
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.handle).toBe('bob');
    expect(Object.keys(rows[0]!)).toEqual(['id', 'handle', 'display_name']);
  });

  it('will not find someone who blocked you', async () => {
    await t.as(ALICE);
    const { rows } = await t.db.query('select * from public.find_profile_by_handle($1)', [
      'mallory',
    ]);
    expect(rows).toHaveLength(0);
  });
});

describe('flock', () => {
  it('shows only edges you are part of', async () => {
    const rows = await selectAs(CAROL, 'select a, b from public.flock');
    expect(rows).toHaveLength(1);
  });

  it('lets the addressee accept a pending request', async () => {
    await t.as(ALICE);
    const { rows } = await t.db.query(
      `update public.flock set status = 'accepted'
        where $1 in (a, b) and status = 'pending' returning status`,
      [ALICE],
    );
    expect(rows).toEqual([{ status: 'accepted' }]);
    await t.asEngine();
    await t.db.query(`update public.flock set status = 'pending' where requested_by = $1`, [CAROL]);
  });

  it('does not let the requester accept their own request', async () => {
    await t.as(CAROL);
    const { rows } = await t.db.query(
      `update public.flock set status = 'accepted' where requested_by = $1 returning status`,
      [CAROL],
    );
    expect(rows).toHaveLength(0);
  });

  it('rejects a request sent on someone else’s behalf', async () => {
    const [a, b] = BOB < CAROL ? [BOB, CAROL] : [CAROL, BOB];
    await t.as(ALICE);
    await expect(
      t.db.query(
        `insert into public.flock (a, b, status, requested_by) values ($1, $2, 'pending', $3)`,
        [a, b, BOB],
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it('rejects a request to someone who blocked you', async () => {
    const [a, b] = ALICE < MALLORY ? [ALICE, MALLORY] : [MALLORY, ALICE];
    await t.as(ALICE);
    await expect(
      t.db.query(
        `insert into public.flock (a, b, status, requested_by) values ($1, $2, 'pending', $3)`,
        [a, b, ALICE],
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it('rejects a request that arrives pre-accepted', async () => {
    const [a, b] = BOB < CAROL ? [BOB, CAROL] : [CAROL, BOB];
    await t.as(BOB);
    await expect(
      t.db.query(
        `insert into public.flock (a, b, status, requested_by) values ($1, $2, 'accepted', $3)`,
        [a, b, BOB],
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it('lets either party unfriend', async () => {
    await createFlock(t, BOB, CAROL, 'accepted', BOB);
    await t.as(CAROL);
    const { rows } = await t.db.query(
      'delete from public.flock where $1 in (a, b) and $2 in (a, b) returning a',
      [BOB, CAROL],
    );
    expect(rows).toHaveLength(1);
  });
});

describe('blocks are one-way mirrors', () => {
  it('shows the blocker their own block', async () => {
    const rows = await selectAs(MALLORY, 'select blocked from public.blocks');
    expect(rows).toEqual([{ blocked: ALICE }]);
  });

  it('hides the block from the person blocked', async () => {
    const rows = await selectAs(ALICE, 'select blocker, blocked from public.blocks');
    expect(rows).toHaveLength(0);
  });

  it('refuses a block created on someone else’s behalf', async () => {
    await t.as(ALICE);
    await expect(
      t.db.query('insert into public.blocks (blocker, blocked) values ($1, $2)', [BOB, CAROL]),
    ).rejects.toThrow(/row-level security/i);
  });
});

describe('messages: the recipient gets nothing until the smoke lands', () => {
  let inFlight: string;

  beforeAll(async () => {
    await t.asEngine();
    const { rows } = await t.db.query<{ id: string }>(
      `insert into public.messages (sender, recipient, body, state, origin_cell, dest_cell)
       values ($1, $2, 'MEET ME AT THE RIDGE', 'IN_FLIGHT', 'r037c090', 'r039c066')
       returning id`,
      [ALICE, BOB],
    );
    inFlight = rows[0]!.id;
    await t.db.query(`insert into public.events (message_id, kind) values ($1, 'SENT')`, [inFlight]);
  });

  it('lets the sender watch their own message in flight', async () => {
    const rows = await selectAs<{ body: string }>(
      ALICE,
      'select body from public.messages where id = $1',
      [inFlight],
    );
    expect(rows).toEqual([{ body: 'MEET ME AT THE RIDGE' }]);
  });

  it('shows the recipient nothing at all before delivery', async () => {
    const rows = await selectAs(BOB, 'select id, body from public.messages where id = $1', [
      inFlight,
    ]);
    expect(rows).toHaveLength(0);
  });

  it('hides the flight events from the recipient too', async () => {
    const rows = await selectAs(BOB, 'select kind from public.events where message_id = $1', [
      inFlight,
    ]);
    expect(rows).toHaveLength(0);
  });

  it('shows the sender their own flight events', async () => {
    const rows = await selectAs(ALICE, 'select kind from public.events where message_id = $1', [
      inFlight,
    ]);
    expect(rows).toEqual([{ kind: 'SENT' }]);
  });

  it('reveals body and body_delivered once the engine marks it DELIVERED', async () => {
    await t.asEngine();
    await t.db.query(
      `update public.messages
          set state = 'DELIVERED', body_delivered = 'MEET ME AT THE R~DGE', delivered_at = now()
        where id = $1`,
      [inFlight],
    );
    await t.db.query(`insert into public.events (message_id, kind) values ($1, 'DELIVERED')`, [
      inFlight,
    ]);

    const rows = await selectAs<{ body: string; body_delivered: string }>(
      BOB,
      'select body, body_delivered from public.messages where id = $1',
      [inFlight],
    );
    expect(rows).toEqual([
      { body: 'MEET ME AT THE RIDGE', body_delivered: 'MEET ME AT THE R~DGE' },
    ]);

    const events = await selectAs(BOB, 'select kind from public.events where message_id = $1', [
      inFlight,
    ]);
    expect(events).toHaveLength(2);
  });

  it('shows a third party nothing, delivered or not', async () => {
    const rows = await selectAs(CAROL, 'select id from public.messages');
    expect(rows).toHaveLength(0);
  });

  it('lets a flock member light a fire', async () => {
    await t.as(ALICE);
    const { rows } = await t.db.query<{ state: string }>(
      `insert into public.messages (sender, recipient, body, origin_cell, dest_cell)
       values ($1, $2, 'SMOKE ON THE WATER', 'r037c090', 'r039c066')
       returning state`,
      [ALICE, BOB],
    );
    expect(rows).toEqual([{ state: 'TRANSMITTING' }]);
  });

  it('refuses a send to someone who is not accepted flock (SPEC §3, REDTEAM F10)', async () => {
    await t.as(ALICE);
    await expect(
      t.db.query(
        `insert into public.messages (sender, recipient, body, origin_cell, dest_cell)
         values ($1, $2, 'hello stranger', 'r037c090', 'r020c040')`,
        [ALICE, CAROL], // pending, not accepted
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it('refuses a send to someone who blocked you', async () => {
    await createFlock(t, ALICE, MALLORY, 'accepted', ALICE);
    await t.as(ALICE);
    await expect(
      t.db.query(
        `insert into public.messages (sender, recipient, body, origin_cell, dest_cell)
         values ($1, $2, 'let me back in', 'r037c090', 'r010c010')`,
        [ALICE, MALLORY],
      ),
    ).rejects.toThrow(/row-level security/i);
    await t.asEngine();
    await t.db.query('delete from public.flock where a in ($1, $2) and b in ($1, $2)', [
      ALICE,
      MALLORY,
    ]);
  });

  it('refuses a send forged as another sender', async () => {
    await t.as(CAROL);
    await expect(
      t.db.query(
        `insert into public.messages (sender, recipient, body, origin_cell, dest_cell)
         values ($1, $2, 'not from me', 'r037c090', 'r039c066')`,
        [ALICE, BOB],
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it('refuses a send that pre-cooks its own flight state', async () => {
    await t.as(ALICE);
    for (const [columns, values] of [
      ["state", "'DELIVERED'"],
      ["route", `'["r037c090","r039c066"]'::jsonb`],
      ["delivered_at", 'now()'],
      ["current_leg", '5'],
      ["body_delivered", "'already garbled'"],
    ] as const) {
      await expect(
        t.db.query(
          `insert into public.messages (sender, recipient, body, origin_cell, dest_cell, ${columns})
           values ($1, $2, 'cheat', 'r037c090', 'r039c066', ${values})`,
          [ALICE, BOB],
        ),
      ).rejects.toThrow();
    }
  });

  it('never lets a client change or delete flight state (ARCHITECTURE §4)', async () => {
    await t.as(ALICE);
    await expect(
      t.db.query(`update public.messages set state = 'DELIVERED' where sender = $1`, [ALICE]),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      t.db.query('delete from public.messages where sender = $1', [ALICE]),
    ).rejects.toThrow(/permission denied/i);
  });
});

describe('reports and reference data', () => {
  it('lets a user report a message they can see', async () => {
    const [message] = await selectAs<{ id: string }>(
      BOB,
      "select id from public.messages where state = 'DELIVERED' limit 1",
    );
    await t.as(BOB);
    const { rows } = await t.db.query(
      'insert into public.reports (reporter, message_id, reason) values ($1, $2, $3) returning id',
      [BOB, message!.id, 'abusive'],
    );
    expect(rows).toHaveLength(1);
  });

  it('refuses a report filed under someone else’s name', async () => {
    await t.as(CAROL);
    await expect(
      t.db.query('insert into public.reports (reporter, reason) values ($1, $2)', [BOB, 'spite']),
    ).rejects.toThrow(/row-level security/i);
  });

  it('shows a user only their own reports', async () => {
    const rows = await selectAs(CAROL, 'select id from public.reports');
    expect(rows).toHaveLength(0);
    const own = await selectAs(BOB, 'select id from public.reports');
    expect(own).toHaveLength(1);
  });

  it('lets any signed-in user read weather and mechanics config', async () => {
    await t.asEngine();
    await t.db.query(
      `insert into public.weather_cells (cell, condition, time_mult, impassable)
       values ('r038c080', 'thunderstorm', 6.0, false)`,
    );
    const weather = await selectAs(CAROL, 'select cell from public.weather_cells');
    expect(weather).toHaveLength(1);

    await t.asEngine();
    await t.db.query(
      `insert into public.mechanics_config (key, value) values ('speed.base_mph', '20'::jsonb)`,
    );
    const config = await selectAs(CAROL, 'select key from public.mechanics_config');
    expect(config).toHaveLength(1);
  });

  it('does not let clients write weather or config', async () => {
    await t.as(CAROL);
    await expect(
      t.db.query(`insert into public.weather_cells (cell) values ('r001c001')`),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      t.db.query(`update public.mechanics_config set value = '999'::jsonb`),
    ).rejects.toThrow(/permission denied/i);
  });

  it('gives an anonymous visitor nothing', async () => {
    for (const table of ['profiles', 'messages', 'weather_cells', 'mechanics_config']) {
      await expect(selectAs(null, `select * from public.${table}`, [], 'anon')).rejects.toThrow(
        /permission denied/i,
      );
    }
  });
});
