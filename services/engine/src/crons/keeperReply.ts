/**
 * The Keeper's reply (ARCHITECTURE §6.3, REDTEAM F5).
 *
 * Roughly half an hour after a message to The Keeper lands, it answers with the
 * next line from `keeper_lines`. Plain data and one cron branch — no LLM, no
 * per-message cost, and the new user's first session ends with a reply instead
 * of silence.
 */

import type { Uuid } from '@smoke/shared';

import { addMinutes } from '../engine/clock.js';
import type { EngineContext } from '../engine/context.js';
import { nextKeeperLine } from '../messages/keeper.js';
import { sendMessage } from '../messages/send.js';
import type { SqlExecutor } from '../db/executor.js';

export interface KeeperStats {
  replied: number;
}

interface DueRow {
  id: Uuid;
  sender: Uuid;
  delivered_at: string;
}

/**
 * Messages delivered to the Keeper that are due a reply and have not had one.
 *
 * Idempotency without a new column: the reply's own SENT event carries
 * `in_reply_to`, so a message that has already been answered is visible in the
 * event log.
 */
async function dueForReply(db: SqlExecutor, keeperId: Uuid, before: Date): Promise<DueRow[]> {
  const { rows } = await db.query<DueRow>(
    `select m.id, m.sender, m.delivered_at
       from public.messages m
      where m.recipient = $1
        and m.state = 'DELIVERED'
        and m.delivered_at is not null
        and m.delivered_at <= $2
        and not exists (
          select 1 from public.events e
           where e.kind = 'SENT'
             and e.payload ->> 'in_reply_to' = m.id::text
        )
      order by m.delivered_at`,
    [keeperId, before.toISOString()],
  );
  return rows;
}

export async function runKeeperReplies(ctx: EngineContext): Promise<KeeperStats> {
  if (ctx.keeperId === null) return { replied: 0 };

  const now = ctx.clock.now();
  const delay = ctx.config.get('keeper.reply_delay_minutes');
  const due = await dueForReply(ctx.db, ctx.keeperId, addMinutes(now, -delay));
  let replied = 0;

  for (const row of due) {
    const line = await nextKeeperLine(ctx.db, row.sender);
    const result = await sendMessage(ctx, {
      senderId: ctx.keeperId,
      recipientId: row.sender,
      body: line,
    });

    await ctx.db.query(
      `update public.events
          set payload = payload || jsonb_build_object('in_reply_to', $2::text)
        where message_id = $1 and kind = 'SENT'`,
      [result.messageId, row.id],
    );
    replied++;
  }

  return { replied };
}
