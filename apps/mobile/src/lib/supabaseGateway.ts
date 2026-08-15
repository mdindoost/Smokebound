/**
 * The real gateway: Supabase for data, the engine transport for anything that
 * changes flight state.
 *
 * Deliberately mechanical. Every read here is a plain select that RLS filters —
 * the client asks for what it wants and the database decides what it may have.
 * Nothing in this file re-implements a rule that lives in a policy.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import type { PreviewResult, SendResult } from './engineTypes';
import type {
  CellWeatherView,
  ConversationView,
  DataGateway,
  FlockEntry,
  MechanicsView,
  ProfileView,
  SessionUser,
  ThreadMessageView,
} from './gateway';
import {
  toConversations,
  toProfileView,
  toThreadMessage,
} from './mapping';
import type { EventRow, MessageRow, ProfileRow } from './mapping';
import type { EngineTransport } from './transport';

const MESSAGE_COLUMNS =
  'id, sender, recipient, body, body_delivered, state, origin_cell, dest_cell, ' +
  'route, segment_etas, current_leg, departed_at, eta, delivered_at, stranded_cell, lost_at, lost_cell, ' +
  'lost_reason, garble_events, created_at';

export class SupabaseGateway implements DataGateway {
  constructor(
    private readonly supabase: SupabaseClient,
    private readonly engine: EngineTransport,
  ) {}

  // --- session -------------------------------------------------------------

  async currentUser(): Promise<SessionUser | null> {
    const { data } = await this.supabase.auth.getUser();
    return data.user ? { id: data.user.id } : null;
  }

  async signInWithPhone(phone: string): Promise<void> {
    const { error } = await this.supabase.auth.signInWithOtp({ phone });
    if (error) throw new Error(error.message);
  }

  async verifyPhoneOtp(phone: string, token: string): Promise<SessionUser> {
    const { data, error } = await this.supabase.auth.verifyOtp({ phone, token, type: 'sms' });
    if (error) throw new Error(error.message);
    if (!data.user) throw new Error('That code did not work.');
    return { id: data.user.id };
  }

  async signOut(): Promise<void> {
    await this.supabase.auth.signOut();
  }

  // --- profile -------------------------------------------------------------

  async myProfile(): Promise<ProfileView | null> {
    const user = await this.currentUser();
    if (!user) return null;
    const { data } = await this.supabase
      .from('profiles')
      .select('id, handle, display_name, home_cell, is_system')
      .eq('id', user.id)
      .maybeSingle();
    return data ? toProfileView(data as ProfileRow) : null;
  }

  async claimProfile(input: {
    handle: string;
    displayName?: string;
    homeCell: string;
  }): Promise<ProfileView> {
    const user = await this.currentUser();
    if (!user) throw new Error('Sign in first.');

    const { data, error } = await this.supabase
      .from('profiles')
      .insert({
        id: user.id,
        handle: input.handle,
        display_name: input.displayName ?? null,
        home_cell: input.homeCell,
      })
      .select('id, handle, display_name, home_cell, is_system')
      .single();

    if (error) {
      // 23505 is unique_violation: the handle is taken.
      throw new Error(error.code === '23505' ? 'That handle is taken.' : error.message);
    }
    return toProfileView(data as ProfileRow);
  }

  async moveFire(homeCell: string): Promise<void> {
    const user = await this.currentUser();
    if (!user) throw new Error('Sign in first.');
    const { error } = await this.supabase
      .from('profiles')
      .update({ home_cell: homeCell })
      .eq('id', user.id);
    if (error) throw new Error(error.message);
  }

  /**
   * Handle search goes through the RPC, which returns identity only — never
   * `home_cell`, so a handle guess cannot be turned into a location probe
   * (REDTEAM F6).
   */
  async findByHandle(handle: string): Promise<ProfileView | null> {
    const { data, error } = await this.supabase.rpc('find_profile_by_handle', {
      p_handle: handle,
    });
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as ProfileRow[];
    return rows[0] ? toProfileView({ ...rows[0], home_cell: null }) : null;
  }

  async keeper(): Promise<ProfileView | null> {
    // Readable because the signup trigger flocks every new profile to it.
    const { data } = await this.supabase
      .from('profiles')
      .select('id, handle, display_name, home_cell, is_system')
      .eq('is_system', true)
      .limit(1)
      .maybeSingle();
    return data ? toProfileView(data as ProfileRow) : null;
  }

  // --- flock ---------------------------------------------------------------

  async listFlock(): Promise<FlockEntry[]> {
    const user = await this.currentUser();
    if (!user) return [];

    const { data: edges } = await this.supabase
      .from('flock')
      .select('a, b, status, requested_by');
    const rows = (edges ?? []) as {
      a: string;
      b: string;
      status: 'pending' | 'accepted';
      requested_by: string;
    }[];
    if (rows.length === 0) return [];

    const otherIds = rows.map((row) => (row.a === user.id ? row.b : row.a));
    const { data: profiles } = await this.supabase
      .from('profiles')
      .select('id, handle, display_name, home_cell, is_system')
      .in('id', otherIds);
    const people = new Map(
      ((profiles ?? []) as ProfileRow[]).map((row) => [row.id, toProfileView(row)]),
    );

    return rows.flatMap((row) => {
      const otherId = row.a === user.id ? row.b : row.a;
      const profile = people.get(otherId);
      if (!profile) return []; // blocked or gone: RLS hid them
      return [{ profile, status: row.status, incoming: row.requested_by !== user.id }];
    });
  }

  async requestFlock(otherId: string): Promise<void> {
    const user = await this.currentUser();
    if (!user) throw new Error('Sign in first.');
    const [a, b] = user.id < otherId ? [user.id, otherId] : [otherId, user.id];
    const { error } = await this.supabase
      .from('flock')
      .insert({ a, b, status: 'pending', requested_by: user.id });
    if (error) throw new Error(error.message);
  }

  async acceptFlock(otherId: string): Promise<void> {
    const user = await this.currentUser();
    if (!user) throw new Error('Sign in first.');
    const [a, b] = user.id < otherId ? [user.id, otherId] : [otherId, user.id];
    const { error } = await this.supabase
      .from('flock')
      .update({ status: 'accepted' })
      .eq('a', a)
      .eq('b', b);
    if (error) throw new Error(error.message);
  }

  async removeFlock(otherId: string): Promise<void> {
    const user = await this.currentUser();
    if (!user) throw new Error('Sign in first.');
    const [a, b] = user.id < otherId ? [user.id, otherId] : [otherId, user.id];
    const { error } = await this.supabase.from('flock').delete().eq('a', a).eq('b', b);
    if (error) throw new Error(error.message);
  }

  // --- safety --------------------------------------------------------------

  async block(otherId: string): Promise<void> {
    const user = await this.currentUser();
    if (!user) throw new Error('Sign in first.');
    const { error } = await this.supabase
      .from('blocks')
      .insert({ blocker: user.id, blocked: otherId });
    if (error) throw new Error(error.message);
  }

  async unblock(otherId: string): Promise<void> {
    const user = await this.currentUser();
    if (!user) throw new Error('Sign in first.');
    const { error } = await this.supabase
      .from('blocks')
      .delete()
      .eq('blocker', user.id)
      .eq('blocked', otherId);
    if (error) throw new Error(error.message);
  }

  async listBlocked(): Promise<ProfileView[]> {
    const { data: blocks } = await this.supabase.from('blocks').select('blocked');
    const ids = ((blocks ?? []) as { blocked: string }[]).map((row) => row.blocked);
    if (ids.length === 0) return [];

    const { data: profiles } = await this.supabase
      .from('profiles')
      .select('id, handle, display_name, home_cell, is_system')
      .in('id', ids);
    return ((profiles ?? []) as ProfileRow[]).map(toProfileView);
  }

  async reportMessage(messageId: string, reason: string): Promise<void> {
    const user = await this.currentUser();
    if (!user) throw new Error('Sign in first.');
    const { error } = await this.supabase
      .from('reports')
      .insert({ reporter: user.id, message_id: messageId, reason });
    if (error) throw new Error(error.message);
  }

  // --- the Ledger ----------------------------------------------------------

  private async loadMessages(filter?: { otherId: string }): Promise<{
    rows: MessageRow[];
    events: EventRow[];
  }> {
    let query = this.supabase.from('messages').select(MESSAGE_COLUMNS);
    if (filter) {
      query = query.or(`sender.eq.${filter.otherId},recipient.eq.${filter.otherId}`);
    }
    const { data, error } = await query.order('created_at', { ascending: true });
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as unknown as MessageRow[];
    if (rows.length === 0) return { rows, events: [] };

    const { data: events } = await this.supabase
      .from('events')
      .select('message_id, kind, payload, created_at')
      .in(
        'message_id',
        rows.map((row) => row.id),
      )
      .order('created_at', { ascending: true });

    return { rows, events: (events ?? []) as EventRow[] };
  }

  /**
   * Your own signals still in the air (ARCHITECTURE §7.1).
   *
   * "Your flock's smoke" in the spec means your own: RLS hides an undelivered
   * message from its recipient entirely, so nobody else's smoke is visible to
   * you even in principle. See the M5 note in the README.
   */
  async inFlight(): Promise<ThreadMessageView[]> {
    const user = await this.currentUser();
    if (!user) return [];

    const { data, error } = await this.supabase
      .from('messages')
      .select(MESSAGE_COLUMNS)
      .in('state', ['TRANSMITTING', 'IN_FLIGHT', 'STRANDED'])
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);

    const rows = (data ?? []) as unknown as MessageRow[];
    return rows.map((row) => toThreadMessage(row, [], user.id));
  }

  async cellWeather(cells: readonly string[]): Promise<Map<string, CellWeatherView>> {
    const out = new Map<string, CellWeatherView>();
    if (cells.length === 0) return out;

    const { data } = await this.supabase
      .from('weather_cells')
      .select('cell, condition, impassable, weather_unknown, wind_mph, wind_dir')
      .in('cell', cells as string[]);

    for (const row of (data ?? []) as {
      cell: string;
      condition: string | null;
      impassable: boolean;
      weather_unknown: boolean;
      wind_mph: number | null;
      wind_dir: number | null;
    }[]) {
      out.set(row.cell, {
        cell: row.cell,
        condition: row.condition,
        impassable: row.impassable,
        weatherUnknown: row.weather_unknown,
        windMph: row.wind_mph,
        windDir: row.wind_dir,
      });
    }
    return out;
  }

  async listConversations(): Promise<ConversationView[]> {
    const user = await this.currentUser();
    if (!user) return [];

    const { rows, events } = await this.loadMessages();
    const messages = rows.map((row) => toThreadMessage(row, events, user.id));
    const senders = new Map(rows.map((row) => [row.id, row]));

    const otherIds = new Set(
      rows.map((row) => (row.sender === user.id ? row.recipient : row.sender)),
    );
    const { data: profiles } = await this.supabase
      .from('profiles')
      .select('id, handle, display_name, home_cell, is_system')
      .in('id', [...otherIds]);
    const people = new Map(
      ((profiles ?? []) as ProfileRow[]).map((row) => [row.id, toProfileView(row)]),
    );

    return toConversations(
      messages,
      people,
      user.id,
      (message) => senders.get(message.id)!.sender,
      (message) => senders.get(message.id)!.recipient,
    );
  }

  async thread(otherId: string): Promise<ThreadMessageView[]> {
    const user = await this.currentUser();
    if (!user) return [];
    const { rows, events } = await this.loadMessages({ otherId });
    return rows.map((row) => toThreadMessage(row, events, user.id));
  }

  async message(messageId: string): Promise<ThreadMessageView | null> {
    const user = await this.currentUser();
    if (!user) return null;

    const { data } = await this.supabase
      .from('messages')
      .select(MESSAGE_COLUMNS)
      .eq('id', messageId)
      .maybeSingle();
    if (!data) return null;

    const { data: events } = await this.supabase
      .from('events')
      .select('message_id, kind, payload, created_at')
      .eq('message_id', messageId)
      .order('created_at', { ascending: true });

    return toThreadMessage(data as unknown as MessageRow, (events ?? []) as EventRow[], user.id);
  }

  // --- the engine ----------------------------------------------------------

  async mechanics(): Promise<MechanicsView> {
    const { data, error } = await this.supabase.from('mechanics_config').select('key, value');
    if (error) throw new Error(error.message);

    const rows = new Map(
      ((data ?? []) as { key: string; value: unknown }[]).map((row) => [row.key, row.value]),
    );
    const number = (key: string): number => {
      const value = rows.get(key);
      // No compiled-in fallback: gameplay numbers come from the table or not at
      // all (ARCHITECTURE §10).
      if (typeof value !== 'number') throw new Error(`mechanics_config is missing ${key}`);
      return value;
    };

    const flag = (key: string): boolean => {
      const value = rows.get(key);
      if (typeof value !== 'boolean') throw new Error(`mechanics_config is missing ${key}`);
      return value;
    };

    return {
      charCap: number('message.char_cap'),
      baseKmh: number('speed.base_kmh'),
      minFloorMinutes: number('delivery.min_floor_minutes'),
      nightVisuals: flag('night.visuals_enabled'),
      nightMechanics: flag('night.enabled'),
      twilightElevationDeg: number('night.twilight_elevation_deg'),
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
