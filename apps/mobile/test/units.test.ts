/**
 * The pure parts of the client: handle rules, the character counter, formatting
 * and copy, and the row→view mapping the Ledger is built from.
 *
 * No render harness. The screens are thin — a counter, a list, a form — and
 * rendering them in a fake DOM would test React Native, not SMOKE.
 */

import { describe, expect, it } from 'vitest';

import {
  deliveredFootnote,
  etaWarningCopy,
  proximityCopy,
  routeSummary,
  stateBlurb,
  stateLabel,
  HISTORY_NOTE,
  LOCATION_EXPLANATION,
} from '../src/lib/copy.js';
import { formatDistance, formatDuration, formatEta, formatSince, formatWalk } from '../src/lib/format.js';
import { countGraphemes, overCap } from '../src/lib/graphemes.js';
import { HANDLE_MAX, displayHandle, validateHandle } from '../src/lib/handle.js';
import { cellFromCoordinates } from '../src/lib/fireCell.js';
import { displayText, isWindDamaged, toConversations, toThreadMessage } from '../src/lib/mapping.js';
import type { ProfileView, ThreadMessageView } from '../src/lib/gateway.js';
import type { MessageRow } from '../src/lib/mapping.js';

describe('handles', () => {
  it('accepts what the schema accepts', () => {
    for (const handle of ['alice', 'river_bend', 'a1b2c3', 'A_9', 'x'.repeat(HANDLE_MAX)]) {
      expect(validateHandle(handle).ok, handle).toBe(true);
    }
  });

  it('rejects what the schema rejects, with a reason a person can act on', () => {
    expect(validateHandle('')).toMatchObject({ reason: 'empty' });
    expect(validateHandle('ab')).toMatchObject({ reason: 'too_short' });
    expect(validateHandle('x'.repeat(HANDLE_MAX + 1))).toMatchObject({ reason: 'too_long' });
    expect(validateHandle('river bend')).toMatchObject({ reason: 'bad_characters' });
    expect(validateHandle('smoke!')).toMatchObject({ reason: 'bad_characters' });
    expect(validateHandle('🔥🔥🔥')).toMatchObject({ reason: 'bad_characters' });
  });

  it('trims before judging, and displays with an @', () => {
    expect(validateHandle('  alice  ').ok).toBe(true);
    expect(displayHandle('alice')).toBe('@alice');
  });
});

describe('the character counter (REDTEAM F20)', () => {
  it('counts what a reader counts', () => {
    expect(countGraphemes('hello')).toBe(5);
    expect(countGraphemes('👨‍👩‍👧‍👦')).toBe(1);
    expect(countGraphemes('👨‍👩‍👧‍👦'.repeat(280))).toBe(280);
    expect(countGraphemes('क्षत्रि')).toBeLessThan([...'क्षत्रि'].length);
    expect(countGraphemes('')).toBe(0);
  });

  it('agrees with the engine about what fits', () => {
    expect(overCap('👨‍👩‍👧‍👦'.repeat(280), 280)).toBe(false);
    expect(overCap('👨‍👩‍👧‍👦'.repeat(281), 280)).toBe(true);
    expect(overCap('x'.repeat(280), 280)).toBe(false);
    expect(overCap('x'.repeat(281), 280)).toBe(true);
  });
});

describe('formatting', () => {
  it('shows distances in miles, because the copy is folksy', () => {
    expect(formatDistance(1150)).toBe('715 mi');
    expect(formatDistance(1)).toBe('less than a mile');
  });

  it('shows durations at a human resolution', () => {
    expect(formatDuration(0.25)).toBe('15 min');
    expect(formatDuration(4)).toBe('4 h');
    expect(formatDuration(4.5)).toBe('4 h 30 min');
    expect(formatDuration(36)).toBe('36 h');
    expect(formatDuration(82)).toBe('3.4 days');
    expect(formatDuration(-1)).toBe('—');
  });

  it('says when a message lands in words, not timestamps', () => {
    const now = new Date('2026-08-14T12:00:00Z');
    expect(formatEta(new Date('2026-08-14T21:40:00Z').toISOString(), now)).toMatch(/^today at /);
    expect(formatEta(new Date('2026-08-15T09:00:00Z').toISOString(), now)).toMatch(/^tomorrow at /);
    expect(formatEta(null, now)).toBe('unknown');
  });

  it('ages a conversation gently', () => {
    const now = new Date('2026-08-14T12:00:00Z');
    expect(formatSince(new Date('2026-08-14T11:59:40Z').toISOString(), now)).toBe('just now');
    expect(formatSince(new Date('2026-08-14T11:30:00Z').toISOString(), now)).toBe('30 min ago');
    expect(formatSince(new Date('2026-08-14T06:00:00Z').toISOString(), now)).toBe('6 h ago');
  });

  it('rounds a walk to something you would say out loud', () => {
    expect(formatWalk(0.4)).toBe('1 min');
    expect(formatWalk(42)).toBe('42 min');
    expect(formatWalk(200)).toBe('3.3 h');
  });
});

describe('copy', () => {
  it('names each state the way the product talks about it', () => {
    expect(stateLabel('TRANSMITTING')).toBe('Transmitting');
    expect(stateLabel('STRANDED')).toBe('Sheltering');
    expect(stateLabel('DELIVERED')).toBe('Arrived');
    expect(stateLabel('LOST')).toBe('Lost to the sky');
    expect(stateBlurb('STRANDED')).toMatch(/storm/i);
  });

  it('makes the proximity joke only when it applies (MECHANICS §7.1)', () => {
    const near = proximityCopy({ sameCell: true, adjacent: false, distanceKm: 3, walkMinutes: 40 });
    expect(near.headline).toMatch(/walk over/);
    expect(near.footnote).toBe('On foot: 40 min.');

    const adjacent = proximityCopy({
      sameCell: false,
      adjacent: true,
      distanceKm: 45,
      walkMinutes: 560,
    });
    expect(adjacent.headline).toMatch(/one hill away/);

    const far = proximityCopy({
      sameCell: false,
      adjacent: false,
      distanceKm: 1150,
      walkMinutes: 14_000,
    });
    expect(far).toEqual({ headline: null, footnote: null });
  });

  it('summarises a route in three lines or fewer', () => {
    const now = new Date('2026-08-14T12:00:00Z');
    const lines = routeSummary(
      {
        totalHours: 36,
        eta: new Date('2026-08-16T00:30:00Z').toISOString(),
        distanceKm: 1150,
        stormsAvoided: 2,
        noRoute: false,
        transmissionSeconds: 210,
      },
      now,
    );
    expect(lines[0]).toContain('715 mi');
    expect(lines[0]).toContain('36 h');
    expect(lines[2]).toBe('Routed around 2 storms on the way.');
  });

  it('tells the truth when the sky is shut (REDTEAM F17)', () => {
    const lines = routeSummary({
      totalHours: null,
      eta: null,
      distanceKm: 1150,
      stormsAvoided: 0,
      noRoute: true,
      transmissionSeconds: 30,
    });
    expect(lines[0]).toMatch(/closed/);
    expect(lines[1]).toMatch(/waits? at your fire/);
  });

  it('explains an ETA shift without blaming anybody', () => {
    expect(
      etaWarningCopy({ previewedHours: 36, actualHours: 60, reason: 'slower' }),
    ).toMatch(/36 h became 2\.5 days/);
    expect(
      etaWarningCopy({ previewedHours: 36, actualHours: 20, reason: 'faster' }),
    ).toMatch(/improved/);
    expect(etaWarningCopy({ previewedHours: 36, actualHours: null, reason: 'no_route' })).toMatch(
      /sky closed/,
    );
  });

  it('says what is stored, plainly, before asking for location (SPEC §8)', () => {
    expect(LOCATION_EXPLANATION).toMatch(/50 km cell/);
    expect(LOCATION_EXPLANATION).toMatch(/never your exact position/);
    expect(LOCATION_EXPLANATION).toMatch(/never in the background/);
  });

  it('credits the practice it borrows from, without caricature (SPEC §2)', () => {
    expect(HISTORY_NOTE).toMatch(/Great Wall/);
    expect(HISTORY_NOTE).toMatch(/Polybius/);
    expect(HISTORY_NOTE).toMatch(/living\s+heritage/);
    for (const forbidden of ['feather', 'teepee', 'tepee', 'tribe of', 'chief']) {
      expect(HISTORY_NOTE.toLowerCase()).not.toContain(forbidden);
    }
  });

  it('states the delivered footnote in the spec’s own shape', () => {
    expect(deliveredFootnote(1150, 14_000)).toBe(
      'This signal travelled 715 mi. On foot: 233.3 h.',
    );
  });
});

describe('location', () => {
  it('maps coordinates to a cell inside the launch region', () => {
    expect(cellFromCoordinates(40.7357, -74.1724)).toEqual({ ok: true, cell: 'r037c090' });
  });

  it('refuses anywhere the weather service does not reach', () => {
    expect(cellFromCoordinates(51.5074, -0.1278)).toMatchObject({ reason: 'outside_region' });
    expect(cellFromCoordinates(43.6532, -79.3832)).toMatchObject({ reason: 'outside_region' });
    expect(cellFromCoordinates(33.0, -73.0)).toMatchObject({ reason: 'outside_region' });
  });
});

// ---------------------------------------------------------------------------

const ME = 'me';
const THEM = 'them';

function row(patch: Partial<MessageRow> = {}): MessageRow {
  return {
    id: 'm1',
    sender: ME,
    recipient: THEM,
    body: 'HELLO',
    body_delivered: null,
    state: 'IN_FLIGHT',
    origin_cell: 'r037c090',
    dest_cell: 'r039c066',
    departed_at: '2026-08-14T12:00:30.000Z',
    eta: '2026-08-16T00:00:00.000Z',
    delivered_at: null,
    stranded_cell: null,
    lost_cell: null,
    lost_reason: null,
    garble_events: [],
    created_at: '2026-08-14T12:00:00.000Z',
    ...patch,
  };
}

describe('row → view mapping', () => {
  it('knows which way a message is going', () => {
    expect(toThreadMessage(row(), [], ME).direction).toBe('out');
    expect(toThreadMessage(row({ sender: THEM, recipient: ME }), [], ME).direction).toBe('in');
  });

  it('shows the delivered text once it has arrived, and the original before', () => {
    const inFlight = toThreadMessage(row(), [], ME);
    expect(displayText(inFlight)).toBe('HELLO');

    const delivered = toThreadMessage(
      row({ state: 'DELIVERED', body_delivered: 'HE~LO', garble_events: [{ cell: 'x' }] }),
      [],
      ME,
    );
    expect(displayText(delivered)).toBe('HE~LO');
    expect(isWindDamaged(delivered)).toBe(true);
  });

  it('does not call an undamaged delivery wind-damaged', () => {
    const clean = toThreadMessage(
      row({ state: 'DELIVERED', body_delivered: 'HELLO', garble_events: [] }),
      [],
      ME,
    );
    expect(isWindDamaged(clean)).toBe(false);
  });

  it('attaches only its own events', () => {
    const events = [
      { message_id: 'm1', kind: 'SENT', payload: null, created_at: '2026-08-14T12:00:00.000Z' },
      { message_id: 'other', kind: 'SENT', payload: null, created_at: '2026-08-14T12:00:00.000Z' },
    ];
    expect(toThreadMessage(row(), events, ME).events.map((e) => e.kind)).toEqual(['SENT']);
  });

  it('builds a Ledger sorted by recency, counting what is still in the sky', () => {
    const rows = [
      row({ id: 'a', created_at: '2026-08-14T10:00:00.000Z', state: 'DELIVERED' }),
      row({ id: 'b', created_at: '2026-08-14T12:00:00.000Z', state: 'IN_FLIGHT' }),
      row({
        id: 'c',
        sender: 'third',
        recipient: ME,
        created_at: '2026-08-14T11:00:00.000Z',
        state: 'DELIVERED',
        body_delivered: 'FROM AFAR',
      }),
    ];
    const messages = rows.map((r) => toThreadMessage(r, [], ME));
    const byId = new Map(rows.map((r) => [r.id, r]));
    const people = new Map<string, ProfileView>([
      [THEM, { id: THEM, handle: 'them', displayName: null, homeCell: 'r039c066' }],
      ['third', { id: 'third', handle: 'third', displayName: null, homeCell: 'r020c040' }],
    ]);

    const conversations = toConversations(
      messages,
      people,
      ME,
      (m) => byId.get(m.id)!.sender,
      (m) => byId.get(m.id)!.recipient,
    );

    expect(conversations.map((c) => c.other.handle)).toEqual(['them', 'third']);
    expect(conversations[0]!.inFlight).toBe(1);
    expect(conversations[1]!.lastLine).toBe('FROM AFAR');
  });

  it('drops a conversation whose profile RLS has hidden', () => {
    const messages: ThreadMessageView[] = [toThreadMessage(row(), [], ME)];
    const conversations = toConversations(
      messages,
      new Map(),
      ME,
      () => ME,
      () => THEM,
    );
    expect(conversations).toEqual([]);
  });
});
