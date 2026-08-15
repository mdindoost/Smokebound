-- ============================================================================
-- SMOKE — spectator links (M6 pull-forward, schema only)
--
-- A sender may one day want to show somebody a flight without that person
-- installing anything: a link that renders the map, the route and the state,
-- and nothing else. This migration reserves the shape. **There is no page and
-- no route yet** — deliberately, because the interesting decisions here are
-- product decisions and none of them have been made.
--
-- A TABLE, NOT A COLUMN ON `messages`
--
-- `messages` is on the router's hot path and is read on every plan, every tick
-- and every replan. A share token is read approximately never — only when
-- somebody follows a link. Widening the hot table for a cold field is the wrong
-- trade, and it forecloses the two things a share link will certainly need:
--
--   * **Revocation.** A link handed to the wrong person must be killable
--     without destroying the message. A column would have to be nulled, which
--     loses the fact that a link ever existed.
--   * **Re-issue.** A revoked link and its replacement are two rows with two
--     histories, not one column overwritten.
--
-- WHAT IS DELIBERATELY NOT DECIDED
--
--   * Whether the page shows the message *body*. The default here is no — the
--     row carries a flag defaulting false — because a share link is a link to
--     a *flight*, and the body is the private part. Ruling required before any
--     page reads it.
--   * Whether a share survives delivery, or expires with the flight.
--   * Whether the recipient may share. Only the sender may today, by policy.
--
-- SECURITY POSTURE
--
-- The token is the capability: anyone holding it can read what the share
-- exposes. So it must be long, random, and generated server-side — never
-- derived from the message id, which is a uuid a client already knows. The
-- column is `unique` and indexed because lookup is by token and nothing else.
-- ============================================================================

create table public.message_shares (
  token text primary key check (length(token) >= 32),
  message_id uuid not null references public.messages (id) on delete cascade,
  created_by uuid not null references public.profiles (id) on delete cascade,
  -- Off by default: a spectator link shows a flight, not a letter. Turning this
  -- on is a product ruling nobody has made.
  reveals_body boolean not null default false,
  created_at timestamptz not null default now(),
  -- Revocation is a fact with a time, not the absence of a row.
  revoked_at timestamptz
);

create index message_shares_message_idx on public.message_shares (message_id);
create index message_shares_live_idx on public.message_shares (message_id)
  where revoked_at is null;

comment on table public.message_shares is
  'Spectator links (M6). Schema only — no page, no routes. A table rather than a '
  'column on messages so links can be revoked and re-issued without touching the '
  'router hot path.';

-- ---------------------------------------------------------------------------
-- RLS
--
-- Senders manage their own links. Nothing here grants *public* read of a
-- message: that is the job of whatever endpoint eventually serves a share, and
-- it will need a security-definer function with the token as its only input.
-- Until that exists, this table is private, which is the correct state for a
-- capability store with no consumer.
-- ---------------------------------------------------------------------------
alter table public.message_shares enable row level security;

create policy message_shares_select_own on public.message_shares
  for select to authenticated
  using (
    exists (
      select 1 from public.messages m
       where m.id = message_shares.message_id and m.sender = auth.uid()
    )
  );

create policy message_shares_insert_own on public.message_shares
  for insert to authenticated
  with check (
    created_by = auth.uid()
    and exists (
      select 1 from public.messages m
       where m.id = message_shares.message_id and m.sender = auth.uid()
    )
  );

-- Revocation is an update of `revoked_at` by the sender; nothing else may change.
create policy message_shares_revoke_own on public.message_shares
  for update to authenticated
  using (created_by = auth.uid())
  with check (created_by = auth.uid());
