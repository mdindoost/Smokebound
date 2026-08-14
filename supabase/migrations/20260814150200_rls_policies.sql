-- ============================================================================
-- SMOKE — Row Level Security (ARCHITECTURE §3)
--
--   "profiles readable by flock members; messages readable by sender+recipient
--    only; body_delivered/body visible to recipient only after state='DELIVERED'
--    (sender always sees own body). weather_cells readable by all authenticated."
--
-- Column-level masking cannot be expressed per-row in Postgres, so the body rule
-- is enforced at the row level: a recipient sees no row at all until DELIVERED.
-- That is also what the product wants — SPEC §4.4: "As a recipient, I get
-- nothing until the smoke arrives."
--
-- All state transitions are engine-only (ARCHITECTURE §4: single writer). No
-- UPDATE or DELETE policy exists on `messages`, `events` or `weather_cells`;
-- the engine writes with the service_role key, which bypasses RLS.
-- ============================================================================

alter table public.profiles enable row level security;
alter table public.flock enable row level security;
alter table public.blocks enable row level security;
alter table public.messages enable row level security;
alter table public.reports enable row level security;
alter table public.weather_cells enable row level security;
alter table public.mechanics_config enable row level security;
alter table public.events enable row level security;

-- Nothing is readable without a session; the engine uses service_role.
revoke all on public.profiles, public.flock, public.blocks, public.messages,
               public.reports, public.weather_cells, public.mechanics_config,
               public.events
  from anon, authenticated;

grant select on public.profiles, public.flock, public.blocks, public.messages,
                public.reports, public.weather_cells, public.mechanics_config,
                public.events
  to authenticated;

grant insert on public.profiles, public.flock, public.blocks, public.messages,
                public.reports
  to authenticated;

grant update on public.profiles, public.flock to authenticated;
grant delete on public.flock, public.blocks to authenticated;
grant usage, select on sequence public.reports_id_seq to authenticated;

-- ---------------------------------------------------------------------------
-- profiles — readable by flock members only (plus yourself)
-- ---------------------------------------------------------------------------
create policy profiles_select_self_or_flock on public.profiles
  for select to authenticated
  using (
    id = auth.uid()
    or (public.has_flock_edge(id) and not public.is_blocked_with(id))
  );

create policy profiles_insert_self on public.profiles
  for insert to authenticated
  with check (id = auth.uid());

create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- ---------------------------------------------------------------------------
-- flock — both parties see the edge; only the addressee can accept it
-- ---------------------------------------------------------------------------
create policy flock_select_party on public.flock
  for select to authenticated
  using (auth.uid() in (a, b));

create policy flock_insert_request on public.flock
  for insert to authenticated
  with check (
    requested_by = auth.uid()
    and auth.uid() in (a, b)
    and status = 'pending'
    and not public.is_blocked_with(case when a = auth.uid() then b else a end)
  );

-- Accepting: the other party flips pending -> accepted. Nothing else may change.
create policy flock_update_accept on public.flock
  for update to authenticated
  using (auth.uid() in (a, b) and requested_by <> auth.uid() and status = 'pending')
  with check (status = 'accepted' and requested_by <> auth.uid());

-- Unfriend, or withdraw/decline a request (SPEC §3 safety requirement).
create policy flock_delete_party on public.flock
  for delete to authenticated
  using (auth.uid() in (a, b));

-- ---------------------------------------------------------------------------
-- blocks — private to the blocker; the blocked user must not be able to tell
-- ---------------------------------------------------------------------------
create policy blocks_select_own on public.blocks
  for select to authenticated
  using (blocker = auth.uid());

create policy blocks_insert_own on public.blocks
  for insert to authenticated
  with check (blocker = auth.uid());

create policy blocks_delete_own on public.blocks
  for delete to authenticated
  using (blocker = auth.uid());

-- ---------------------------------------------------------------------------
-- messages
-- ---------------------------------------------------------------------------
-- Sender always sees their own message; recipient sees nothing until it lands.
create policy messages_select_sender_or_delivered_recipient on public.messages
  for select to authenticated
  using (
    sender = auth.uid()
    or (recipient = auth.uid() and state = 'DELIVERED')
  );

-- Clients may light a fire; everything after that is engine-owned. The insert
-- must look exactly like a fresh send: no route, no state, no flight history.
create policy messages_insert_own on public.messages
  for insert to authenticated
  with check (
    sender = auth.uid()
    and recipient <> auth.uid()
    and public.is_flock_accepted(recipient)
    and not public.is_blocked_with(recipient)
    and state = 'TRANSMITTING'
    and body_delivered is null
    and route is null
    and segment_etas is null
    and current_leg = 0
    and departed_at is null
    and eta is null
    and stranded_since is null
    and stranded_cell is null
    and garble_events = '[]'::jsonb
    and lost_at is null
    and lost_cell is null
    and lost_reason is null
    and delivered_at is null
  );

-- ---------------------------------------------------------------------------
-- reports — write-only from the client's perspective, moderated via service_role
-- ---------------------------------------------------------------------------
create policy reports_select_own on public.reports
  for select to authenticated
  using (reporter = auth.uid());

create policy reports_insert_own on public.reports
  for insert to authenticated
  with check (
    reporter = auth.uid()
    and (
      message_id is null
      or exists (
        select 1 from public.messages m
         where m.id = message_id
           and (m.sender = auth.uid() or m.recipient = auth.uid())
      )
    )
  );

-- ---------------------------------------------------------------------------
-- events — visible exactly when their message is
-- ---------------------------------------------------------------------------
create policy events_select_visible_message on public.events
  for select to authenticated
  using (
    exists (
      select 1 from public.messages m
       where m.id = events.message_id
         and (m.sender = auth.uid() or (m.recipient = auth.uid() and m.state = 'DELIVERED'))
    )
  );

-- ---------------------------------------------------------------------------
-- weather_cells / mechanics_config — read-only reference data for any session
-- ---------------------------------------------------------------------------
create policy weather_cells_select_all on public.weather_cells
  for select to authenticated
  using (true);

create policy mechanics_config_select_all on public.mechanics_config
  for select to authenticated
  using (true);
