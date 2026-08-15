/**
 * A `DataGateway` backed by a real Postgres with real RLS, for the two-client
 * end-to-end run.
 *
 * This is the honest version of "two simulators exchange a message": both sides
 * go through the same interface the screens use, every read passes through the
 * same policies the app will face in production, and the engine on the other end
 * is the real engine. What it does not exercise is the Supabase client itself —
 * see the note in the test file.
 */

import type {
  CellWeatherView,
  ConversationView,
  DataGateway,
  FlockEntry,
  MechanicsView,
  ProfileView,
  SessionUser,
  ThreadMessageView,
} from '../../src/lib/gateway';
import { EngineRequestError } from '../../src/lib/engineTypes';
import type { PreviewResult, SendResult } from '../../src/lib/engineTypes';
import { toConversations, toProfileView, toThreadMessage } from '../../src/lib/mapping';
import type { EventRow, MessageRow, ProfileRow } from '../../src/lib/mapping';
import type { EngineTransport } from '../../src/lib/transport';
import type { EngineRequestKind } from '../../src/lib/engineTypes';

export interface SqlRunner {
  /** Run as the given signed-in user, with RLS applied. */
  asUser<Row>(userId: string, sql: string, params?: unknown[]): Promise<Row[]>;
  /** Run as the engine (service role). */
  asEngine<Row>(sql: string, params?: unknown[]): Promise<Row[]>;
}

const MESSAGE_COLUMNS = `id, sender, recipient, body, body_delivered, state, origin_cell,
  dest_cell, route, segment_etas, departed_at, eta, delivered_at, stranded_cell, lost_at, lost_cell,
  lost_reason, garble_events, created_at`;

export class PgGateway implements DataGateway {
  constructor(
    private readonly userId: string,
    private readonly sql: SqlRunner,
    private readonly engine: EngineTransport,
  ) {}

  private run<Row>(sql: string, params: unknown[] = []): Promise<Row[]> {
    return this.sql.asUser<Row>(this.userId, sql, params);
  }

  // --- session -------------------------------------------------------------

  async currentUser(): Promise<SessionUser | null> {
    return { id: this.userId };
  }

  async signInWithPhone(): Promise<void> {
    throw new Error('not part of the end-to-end run');
  }

  async verifyPhoneOtp(): Promise<SessionUser> {
    throw new Error('not part of the end-to-end run');
  }

  async signOut(): Promise<void> {
    /* nothing to do */
  }

  // --- profile -------------------------------------------------------------

  async myProfile(): Promise<ProfileView | null> {
    const rows = await this.run<ProfileRow>(
      `select id, handle, display_name, home_cell, is_system from public.profiles where id = $1`,
      [this.userId],
    );
    return rows[0] ? toProfileView(rows[0]) : null;
  }

  async claimProfile(input: {
    handle: string;
    displayName?: string;
    homeCell: string;
  }): Promise<ProfileView> {
    const rows = await this.run<ProfileRow>(
      `insert into public.profiles (id, handle, display_name, home_cell)
       values ($1, $2, $3, $4)
       returning id, handle, display_name, home_cell, is_system`,
      [this.userId, input.handle, input.displayName ?? null, input.homeCell],
    );
    return toProfileView(rows[0]!);
  }

  async moveFire(homeCell: string): Promise<void> {
    await this.run(`update public.profiles set home_cell = $2 where id = $1`, [
      this.userId,
      homeCell,
    ]);
  }

  async findByHandle(handle: string): Promise<ProfileView | null> {
    const rows = await this.run<{ id: string; handle: string; display_name: string | null }>(
      `select * from public.find_profile_by_handle($1)`,
      [handle],
    );
    return rows[0] ? toProfileView({ ...rows[0], home_cell: null }) : null;
  }

  async keeper(): Promise<ProfileView | null> {
    const rows = await this.run<ProfileRow>(
      `select id, handle, display_name, home_cell, is_system from public.profiles
        where is_system limit 1`,
    );
    return rows[0] ? toProfileView(rows[0]) : null;
  }

  // --- flock ---------------------------------------------------------------

  async listFlock(): Promise<FlockEntry[]> {
    const edges = await this.run<{
      a: string;
      b: string;
      status: 'pending' | 'accepted';
      requested_by: string;
    }>(`select a, b, status, requested_by from public.flock`);
    if (edges.length === 0) return [];

    const otherIds = edges.map((edge) => (edge.a === this.userId ? edge.b : edge.a));
    const profiles = await this.run<ProfileRow>(
      `select id, handle, display_name, home_cell, is_system from public.profiles
        where id = any($1::uuid[])`,
      [otherIds],
    );
    const people = new Map(profiles.map((row) => [row.id, toProfileView(row)]));

    return edges.flatMap((edge) => {
      const otherId = edge.a === this.userId ? edge.b : edge.a;
      const profile = people.get(otherId);
      if (!profile) return [];
      return [{ profile, status: edge.status, incoming: edge.requested_by !== this.userId }];
    });
  }

  private pair(otherId: string): [string, string] {
    return this.userId < otherId ? [this.userId, otherId] : [otherId, this.userId];
  }

  async requestFlock(otherId: string): Promise<void> {
    const [a, b] = this.pair(otherId);
    await this.run(
      `insert into public.flock (a, b, status, requested_by) values ($1, $2, 'pending', $3)`,
      [a, b, this.userId],
    );
  }

  async acceptFlock(otherId: string): Promise<void> {
    const [a, b] = this.pair(otherId);
    await this.run(`update public.flock set status = 'accepted' where a = $1 and b = $2`, [a, b]);
  }

  async removeFlock(otherId: string): Promise<void> {
    const [a, b] = this.pair(otherId);
    await this.run(`delete from public.flock where a = $1 and b = $2`, [a, b]);
  }

  // --- safety --------------------------------------------------------------

  async block(otherId: string): Promise<void> {
    await this.run(`insert into public.blocks (blocker, blocked) values ($1, $2)`, [
      this.userId,
      otherId,
    ]);
  }

  async unblock(otherId: string): Promise<void> {
    await this.run(`delete from public.blocks where blocker = $1 and blocked = $2`, [
      this.userId,
      otherId,
    ]);
  }

  async listBlocked(): Promise<ProfileView[]> {
    const rows = await this.run<ProfileRow>(
      `select p.id, p.handle, p.display_name, p.home_cell, p.is_system
         from public.blocks b join public.profiles p on p.id = b.blocked
        where b.blocker = $1`,
      [this.userId],
    );
    return rows.map(toProfileView);
  }

  async reportMessage(messageId: string, reason: string): Promise<void> {
    await this.run(
      `insert into public.reports (reporter, message_id, reason) values ($1, $2, $3)`,
      [this.userId, messageId, reason],
    );
  }

  // --- the Sky --------------------------------------------------------------

  async inFlight(): Promise<ThreadMessageView[]> {
    const rows = await this.run<MessageRow>(
      `select ${MESSAGE_COLUMNS} from public.messages
        where state in ('TRANSMITTING', 'IN_FLIGHT', 'STRANDED')
        order by created_at desc`,
    );
    return rows.map((row) => toThreadMessage(row, [], this.userId));
  }

  async cellWeather(cells: readonly string[]): Promise<Map<string, CellWeatherView>> {
    const out = new Map<string, CellWeatherView>();
    if (cells.length === 0) return out;
    const rows = await this.run<{
      cell: string;
      condition: string | null;
      impassable: boolean;
      weather_unknown: boolean;
      wind_mph: number | null;
    }>(
      `select cell, condition, impassable, weather_unknown, wind_mph
         from public.weather_cells where cell = any($1::text[])`,
      [cells as string[]],
    );
    for (const row of rows) {
      out.set(row.cell, {
        cell: row.cell,
        condition: row.condition,
        impassable: row.impassable,
        weatherUnknown: row.weather_unknown,
        windMph: row.wind_mph,
      });
    }
    return out;
  }

  // --- the Ledger ----------------------------------------------------------

  private async loadThread(otherId?: string): Promise<ThreadMessageView[]> {
    const rows = otherId
      ? await this.run<MessageRow>(
          `select ${MESSAGE_COLUMNS} from public.messages
            where sender = $1 or recipient = $1 order by created_at`,
          [otherId],
        )
      : await this.run<MessageRow>(
          `select ${MESSAGE_COLUMNS} from public.messages order by created_at`,
        );
    if (rows.length === 0) return [];

    const events = await this.run<EventRow>(
      `select message_id, kind, payload, created_at from public.events
        where message_id = any($1::uuid[]) order by created_at`,
      [rows.map((row) => row.id)],
    );
    return rows.map((row) => toThreadMessage(row, events, this.userId));
  }

  async listConversations(): Promise<ConversationView[]> {
    const rows = await this.run<MessageRow>(
      `select ${MESSAGE_COLUMNS} from public.messages order by created_at`,
    );
    if (rows.length === 0) return [];

    const events = await this.run<EventRow>(
      `select message_id, kind, payload, created_at from public.events
        where message_id = any($1::uuid[]) order by created_at`,
      [rows.map((row) => row.id)],
    );
    const messages = rows.map((row) => toThreadMessage(row, events, this.userId));
    const byId = new Map(rows.map((row) => [row.id, row]));

    const otherIds = [
      ...new Set(rows.map((row) => (row.sender === this.userId ? row.recipient : row.sender))),
    ];
    const profiles = await this.run<ProfileRow>(
      `select id, handle, display_name, home_cell, is_system from public.profiles
        where id = any($1::uuid[])`,
      [otherIds],
    );
    const people = new Map(profiles.map((row) => [row.id, toProfileView(row)]));

    return toConversations(
      messages,
      people,
      this.userId,
      (message) => byId.get(message.id)!.sender,
      (message) => byId.get(message.id)!.recipient,
    );
  }

  thread(otherId: string): Promise<ThreadMessageView[]> {
    return this.loadThread(otherId);
  }

  async message(messageId: string): Promise<ThreadMessageView | null> {
    const rows = await this.run<MessageRow>(
      `select ${MESSAGE_COLUMNS} from public.messages where id = $1`,
      [messageId],
    );
    if (!rows[0]) return null;
    const events = await this.run<EventRow>(
      `select message_id, kind, payload, created_at from public.events
        where message_id = $1 order by created_at`,
      [messageId],
    );
    return toThreadMessage(rows[0], events, this.userId);
  }

  // --- the engine ----------------------------------------------------------

  async mechanics(): Promise<MechanicsView> {
    const rows = await this.run<{ key: string; value: unknown }>(
      `select key, value from public.mechanics_config`,
    );
    const byKey = new Map(rows.map((row) => [row.key, row.value]));
    const number = (key: string): number => {
      const value = byKey.get(key);
      if (typeof value !== 'number') throw new Error(`mechanics_config is missing ${key}`);
      return value;
    };
    return {
      charCap: number('message.char_cap'),
      baseKmh: number('speed.base_kmh'),
      minFloorMinutes: number('delivery.min_floor_minutes'),
    };
  }

  preview(recipientId: string, body: string): Promise<PreviewResult> {
    return this.engine.request<PreviewResult>('preview', { recipient: recipientId, body });
  }

  send(recipientId: string, body: string, previewToken?: string): Promise<SendResult> {
    return this.engine.request<SendResult>('send', {
      recipient: recipientId,
      body,
      preview_token: previewToken,
    });
  }

  resend(messageId: string): Promise<SendResult> {
    return this.engine.request<SendResult>('resend', { message_id: messageId });
  }
}

/**
 * The table transport, driven synchronously: insert the request, let the engine
 * drain it, read the response. Same tables, same RLS, same handlers as the
 * realtime version — only the waiting is different.
 */
export class PolledTableTransport implements EngineTransport {
  constructor(
    private readonly userId: string,
    private readonly sql: SqlRunner,
    private readonly drain: () => Promise<unknown>,
  ) {}

  async request<T>(kind: EngineRequestKind, payload: Record<string, unknown>): Promise<T> {
    // Deliberately does NOT pass `requester`: the app relies on the column's
    // auth.uid() default, and a test double that fills it in by hand cannot see
    // the RLS failure that behaviour caused in production.
    const inserted = await this.sql.asUser<{ id: string }>(
      this.userId,
      `insert into public.engine_requests (kind, payload)
       values ($1, $2::jsonb) returning id`,
      [kind, JSON.stringify(payload)],
    );
    const requestId = inserted[0]!.id;

    await this.drain();

    const rows = await this.sql.asUser<{
      ok: boolean;
      payload: Record<string, unknown> | null;
      error_code: string | null;
      error_message: string | null;
    }>(
      this.userId,
      `select ok, payload, error_code, error_message from public.engine_responses
        where request_id = $1`,
      [requestId],
    );

    const row = rows[0];
    if (!row) throw new EngineRequestError('TIMEOUT', 'The engine did not answer.');
    if (row.ok) return row.payload as T;
    throw new EngineRequestError(
      row.error_code ?? 'INTERNAL',
      row.error_message ?? 'The fire went out.',
      row.payload ?? {},
    );
  }
}
