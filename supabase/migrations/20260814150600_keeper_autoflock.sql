-- ============================================================================
-- SMOKE — every new fire is flocked to The Keeper (SPEC §3, REDTEAM F5)
--
-- The Keeper only works if it is already there when the user arrives: the whole
-- point is that day one contains a complete send → track → deliver loop without
-- waiting for a friend to install anything.
--
-- Done as a trigger rather than in the client because the edge has to be
-- `accepted` from the start, and RLS (correctly) forbids a client from inserting
-- a pre-accepted flock row.
-- ============================================================================

create or replace function public.flock_new_profile_to_keeper()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  keeper_id uuid;
begin
  if new.is_system then
    return new;  -- the Keeper does not befriend itself
  end if;

  select id into keeper_id from public.profiles where is_system limit 1;
  if keeper_id is null then
    return new;  -- not seeded yet; `npm run seed -- --keeper` fixes that
  end if;

  insert into public.flock (a, b, status, requested_by)
  values (least(new.id, keeper_id), greatest(new.id, keeper_id), 'accepted', keeper_id)
  on conflict (a, b) do nothing;

  return new;
end;
$$;

create trigger profiles_flock_to_keeper
  after insert on public.profiles
  for each row execute function public.flock_new_profile_to_keeper();
