-- ============================================================================
-- SMOKE — you can still see who you blocked
--
-- The profiles policy hid anyone on either side of a block, which is right for
-- the person who was blocked and wrong for the person who did the blocking:
-- their own block list rendered as a row of anonymous ids, and unblocking meant
-- guessing. You already know who you blocked; the block hides you from *them*.
-- ============================================================================

drop policy if exists profiles_select_self_or_flock on public.profiles;

create policy profiles_select_self_or_flock on public.profiles
  for select to authenticated
  using (
    id = auth.uid()
    or (public.has_flock_edge(id) and not public.is_blocked_with(id))
    -- Someone you have blocked stays visible to you, and only to you.
    or exists (
      select 1 from public.blocks b
       where b.blocker = auth.uid() and b.blocked = profiles.id
    )
  );
