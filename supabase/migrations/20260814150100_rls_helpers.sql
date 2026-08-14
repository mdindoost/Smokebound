-- ============================================================================
-- SMOKE — RLS helper functions (ARCHITECTURE §3)
--
-- These are SECURITY DEFINER on purpose: a policy on `profiles` has to know
-- whether a flock edge or a block exists, but the calling user cannot see rows
-- of `blocks` where someone else is the blocker. Without a definer function the
-- "they blocked me" direction would be invisible to the policy.
--
-- Each function pins search_path and is granted to `authenticated` only.
-- ============================================================================

-- Status of the flock edge between the caller and `other`, or null if none.
create or replace function public.flock_status(other uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select f.status
    from public.flock f
   where f.a = least(auth.uid(), other)
     and f.b = greatest(auth.uid(), other);
$$;

-- True when the caller and `other` are accepted flock members.
create or replace function public.is_flock_accepted(other uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.flock_status(other) = 'accepted', false);
$$;

-- True when any flock edge exists (pending or accepted) — pending requests must
-- be able to render the requester's handle.
create or replace function public.has_flock_edge(other uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.flock_status(other) is not null;
$$;

-- True when either party has blocked the other (REDTEAM F1).
create or replace function public.is_blocked_with(other uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.blocks b
     where (b.blocker = auth.uid() and b.blocked = other)
        or (b.blocker = other and b.blocked = auth.uid())
  );
$$;

-- Handle lookup for "add a friend by handle" (SPEC §3).
--
-- Profiles are otherwise readable by flock members only, so adding a stranger
-- needs a narrow escape hatch. It returns identity only — never `home_cell` —
-- so a handle guess cannot be turned into a location probe (REDTEAM F6).
create or replace function public.find_profile_by_handle(p_handle text)
returns table (id uuid, handle text, display_name text)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.handle, p.display_name
    from public.profiles p
   where auth.uid() is not null
     and lower(p.handle) = lower(p_handle)
     and not public.is_blocked_with(p.id)
   limit 1;
$$;

revoke execute on function public.flock_status(uuid) from public, anon;
revoke execute on function public.is_flock_accepted(uuid) from public, anon;
revoke execute on function public.has_flock_edge(uuid) from public, anon;
revoke execute on function public.is_blocked_with(uuid) from public, anon;
revoke execute on function public.find_profile_by_handle(text) from public, anon;

grant execute on function public.flock_status(uuid) to authenticated;
grant execute on function public.is_flock_accepted(uuid) to authenticated;
grant execute on function public.has_flock_edge(uuid) to authenticated;
grant execute on function public.is_blocked_with(uuid) to authenticated;
grant execute on function public.find_profile_by_handle(text) to authenticated;
