/**
 * Every SQL statement the lifecycle needs, in one place.
 *
 * The engine writes with the service role, so RLS does not apply here — which
 * makes it the one layer where a mistake is not caught by the database. Keeping
 * the statements together (rather than scattered through the crons) is what
 * makes them reviewable as a set.
 */

import type {
  CellId,
  EventKind,
  FlockStatus,
  Message,
  MessageState,
  Profile,
  SegmentEta,
  Uuid,
} from '@smoke/shared';

import type { SqlExecutor } from './executor.js';

export interface GarbleEventRow {
  cell: CellId;
  at: string;
  chars_hit: number;
}

const MESSAGE_COLUMNS = `id, sender, recipient, body, body_delivered, state, origin_cell,
  dest_cell, route, segment_etas, current_leg, departed_at, eta, stranded_since, stranded_cell,
  garble_events, lost_at, lost_cell, lost_reason, delivered_at, created_at`;

export async function getProfile(db: SqlExecutor, id: Uuid): Promise<Profile | null> {
  const { rows } = await db.query<Profile>(
    `select id, handle, display_name, home_cell, last_active_at, expo_push_token, created_at
       from public.profiles where id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

export async function getProfileByHandle(db: SqlExecutor, handle: string): Promise<Profile | null> {
  const { rows } = await db.query<Profile>(
    `select id, handle, display_name, home_cell, last_active_at, expo_push_token, created_at
       from public.profiles where lower(handle) = lower($1)`,
    [handle],
  );
  return rows[0] ?? null;
}

export async function flockStatusBetween(
  db: SqlExecutor,
  x: Uuid,
  y: Uuid,
): Promise<FlockStatus | null> {
  const { rows } = await db.query<{ status: FlockStatus }>(
    `select status from public.flock where a = least($1::uuid, $2::uuid) and b = greatest($1::uuid, $2::uuid)`,
    [x, y],
  );
  return rows[0]?.status ?? null;
}

export async function isBlockedBetween(db: SqlExecutor, x: Uuid, y: Uuid): Promise<boolean> {
  const { rows } = await db.query<{ blocked: boolean }>(
    `select exists (
       select 1 from public.blocks
        where (blocker = $1 and blocked = $2) or (blocker = $2 and blocked = $1)
     ) as blocked`,
    [x, y],
  );
  return rows[0]?.blocked === true;
}

export async function countSendsSince(db: SqlExecutor, sender: Uuid, since: Date): Promise<number> {
  const { rows } = await db.query<{ count: string }>(
    `select count(*)::text as count from public.messages
      where sender = $1 and created_at >= $2`,
    [sender, since.toISOString()],
  );
  return Number(rows[0]?.count ?? 0);
}

export interface NewMessageRow {
  sender: Uuid;
  recipient: Uuid;
  body: string;
  originCell: CellId;
  destCell: CellId;
  route: CellId[] | null;
  segmentEtas: SegmentEta[] | null;
  departedAt: Date;
  eta: Date | null;
  /**
   * Written explicitly from the engine clock rather than left to `now()`: one
   * clock has to own the story, or a time-travelled test compares a fake
   * `delivered_at` against a real `created_at`.
   */
  createdAt: Date;
}

export async function insertMessage(db: SqlExecutor, row: NewMessageRow): Promise<Message> {
  const { rows } = await db.query<Message>(
    `insert into public.messages
       (sender, recipient, body, origin_cell, dest_cell, route, segment_etas, departed_at, eta, created_at)
     values ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9, $10)
     returning ${MESSAGE_COLUMNS}`,
    [
      row.sender,
      row.recipient,
      row.body,
      row.originCell,
      row.destCell,
      row.route === null ? null : JSON.stringify(row.route),
      row.segmentEtas === null ? null : JSON.stringify(row.segmentEtas),
      row.departedAt.toISOString(),
      row.eta === null ? null : row.eta.toISOString(),
      row.createdAt.toISOString(),
    ],
  );
  return rows[0]!;
}

export async function getMessage(db: SqlExecutor, id: Uuid): Promise<Message | null> {
  const { rows } = await db.query<Message>(
    `select ${MESSAGE_COLUMNS} from public.messages where id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

export async function messagesInStates(
  db: SqlExecutor,
  states: readonly MessageState[],
): Promise<Message[]> {
  const { rows } = await db.query<Message>(
    `select ${MESSAGE_COLUMNS} from public.messages
      where state = any($1::text[]) order by created_at`,
    [states as string[]],
  );
  return rows;
}

export interface MessagePatch {
  state?: MessageState;
  route?: CellId[] | null;
  segmentEtas?: SegmentEta[] | null;
  currentLeg?: number;
  eta?: Date | null;
  strandedSince?: Date | null;
  strandedCell?: CellId | null;
  garbleEvents?: GarbleEventRow[];
  bodyDelivered?: string | null;
  deliveredAt?: Date | null;
  lostAt?: Date | null;
  lostCell?: CellId | null;
  lostReason?: string | null;
}

const ISO = (value: Date | null | undefined): string | null =>
  value === null || value === undefined ? null : value.toISOString();

export async function updateMessage(
  db: SqlExecutor,
  id: Uuid,
  patch: MessagePatch,
): Promise<Message> {
  const sets: string[] = [];
  const values: unknown[] = [];
  const push = (sql: string, value: unknown): void => {
    values.push(value);
    sets.push(`${sql} = $${values.length}`);
  };

  if (patch.state !== undefined) push('state', patch.state);
  if (patch.route !== undefined) {
    values.push(patch.route === null ? null : JSON.stringify(patch.route));
    sets.push(`route = $${values.length}::jsonb`);
  }
  if (patch.segmentEtas !== undefined) {
    values.push(patch.segmentEtas === null ? null : JSON.stringify(patch.segmentEtas));
    sets.push(`segment_etas = $${values.length}::jsonb`);
  }
  if (patch.currentLeg !== undefined) push('current_leg', patch.currentLeg);
  if (patch.eta !== undefined) push('eta', ISO(patch.eta));
  if (patch.strandedSince !== undefined) push('stranded_since', ISO(patch.strandedSince));
  if (patch.strandedCell !== undefined) push('stranded_cell', patch.strandedCell);
  if (patch.garbleEvents !== undefined) {
    values.push(JSON.stringify(patch.garbleEvents));
    sets.push(`garble_events = $${values.length}::jsonb`);
  }
  if (patch.bodyDelivered !== undefined) push('body_delivered', patch.bodyDelivered);
  if (patch.deliveredAt !== undefined) push('delivered_at', ISO(patch.deliveredAt));
  if (patch.lostAt !== undefined) push('lost_at', ISO(patch.lostAt));
  if (patch.lostCell !== undefined) push('lost_cell', patch.lostCell);
  if (patch.lostReason !== undefined) push('lost_reason', patch.lostReason);

  if (sets.length === 0) {
    const existing = await getMessage(db, id);
    if (!existing) throw new Error(`message ${id} disappeared`);
    return existing;
  }

  values.push(id);
  const { rows } = await db.query<Message>(
    `update public.messages set ${sets.join(', ')} where id = $${values.length}
     returning ${MESSAGE_COLUMNS}`,
    values,
  );
  return rows[0]!;
}

export async function recordEvent(
  db: SqlExecutor,
  messageId: Uuid,
  kind: EventKind,
  payload: Record<string, unknown> = {},
): Promise<void> {
  await db.query(
    `insert into public.events (message_id, kind, payload) values ($1, $2, $3::jsonb)`,
    [messageId, kind, JSON.stringify(payload)],
  );
}

export async function eventsFor(
  db: SqlExecutor,
  messageId: Uuid,
): Promise<{ kind: EventKind; payload: Record<string, unknown> | null; created_at: string }[]> {
  const { rows } = await db.query<{
    kind: EventKind;
    payload: Record<string, unknown> | null;
    created_at: string;
  }>(`select kind, payload, created_at from public.events where message_id = $1 order by id`, [
    messageId,
  ]);
  return rows;
}

export async function countKeeperRepliesTo(db: SqlExecutor, keeper: Uuid, user: Uuid): Promise<number> {
  const { rows } = await db.query<{ count: string }>(
    `select count(*)::text as count from public.messages where sender = $1 and recipient = $2`,
    [keeper, user],
  );
  return Number(rows[0]?.count ?? 0);
}

export async function keeperLine(db: SqlExecutor, index: number): Promise<string | null> {
  const { rows } = await db.query<{ line: string }>(
    `select line from public.keeper_lines order by id offset $1 limit 1`,
    [index],
  );
  return rows[0]?.line ?? null;
}

export async function countKeeperLines(db: SqlExecutor): Promise<number> {
  const { rows } = await db.query<{ count: string }>(
    `select count(*)::text as count from public.keeper_lines`,
  );
  return Number(rows[0]?.count ?? 0);
}
