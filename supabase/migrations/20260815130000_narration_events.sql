-- ============================================================================
-- SMOKE — tower voices (M5.7 §2)
--
-- The Ledger records what happened to a message; these are the events that let
-- it record what the *stations* saw. A signal crossing a continent for three
-- days should produce a scroll worth reading, and until now it produced four
-- lines: sent, departed, delivered, and whatever went wrong.
--
-- Deliberately narrow. These carry no mechanics — they change no route, no ETA,
-- no outcome — and the engine emits them only for things client-side arithmetic
-- cannot derive. Sunset and sunrise crossings stay client-side, because given
-- the route, the segment ETAs and the sun they are deterministic, and storing a
-- derivation is how tables rot.
--
-- **R21 is already enforced and needs nothing here.** `events_select_visible_
-- message` lets a recipient read events only once `state = 'DELIVERED'`, so a
-- tower's voice reaches the sender's Ledger and nowhere else until the message
-- lands. A narration event cannot become a pre-delivery notification even by
-- accident.
-- ============================================================================

alter table public.events drop constraint events_kind_check;

alter table public.events add constraint events_kind_check check (
  kind in (
    -- lifecycle
    'SENT', 'DEPARTED', 'STRANDED', 'RESUMED', 'GARBLED', 'DELIVERED', 'LOST',
    -- tower voices (M5.7 §2): narration only, never mechanics
    'SIGHTED',        -- a station reports the signal passing
    'WIND_ROSE',      -- wind crossed into gale over a named place
    'WIND_EASED',     -- and back out of it
    'FOG_SET_IN',     -- the air went blind ahead
    'SKY_CLEARED'     -- and opened again
  )
);

comment on column public.events.kind is
  'Lifecycle events plus tower voices (M5.7 §2). Narration kinds carry no '
  'mechanics and are throttled by narration.min_interval_hours; sunset and '
  'sunrise crossings are deliberately NOT here, being derivable client-side.';
