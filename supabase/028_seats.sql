-- PER SEAT PRICING FOR TEAMS
--
-- Teams were built to grow revenue and, as first shipped, shrank it: five people shared
-- one $30 plan, so a team was strictly cheaper than five individuals doing the same
-- work. That was an oversight rather than a strategy.
--
-- A seat is the same $30 a year the single account already costs. Nothing gets more
-- expensive for the person working alone, which is most people: one seat is one plan.
--
-- WHERE THE NUMBER LIVES. On the subscription, not on the organisation, because the
-- subscription is the thing Stripe is actually billing. Keeping a seat count anywhere
-- else would mean two sources of truth for how many people have been paid for, and the
-- one Stripe does not know about would be the one that drifts.
alter table public.subscriptions
  add column if not exists seats integer not null default 1 check (seats >= 1);

-- ---------------------------------------------------------------------------
-- HOW MANY SEATS ARE IN USE
--
-- Counted from membership rather than stored, so it cannot disagree with reality. A
-- stored counter would need updating on every join, leave, removal and handover, and
-- the first one that got missed would either sell a seat twice or refuse one that was
-- paid for.
-- ---------------------------------------------------------------------------
create or replace function public.seats_in_use(p_owner uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select count(*)::integer
       from public.org_members m
       join public.organisations o on o.id = m.org_id
      where o.owner_user_id = p_owner),
    1
  );
$$;

-- The owner alone is one seat, so a team of one is priced exactly like a single
-- account. Teams that already exist keep working: seats defaults to 1 and the checks
-- below only ever gate ADDING somebody, never anybody already in.
