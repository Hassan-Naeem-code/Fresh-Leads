-- spend_credits: the general charge used by bulk enrichment.
--
-- The function it replaced was grant_credits with a negative amount, which silently
-- did nothing, so lists were enriched free. These assertions pin the behaviour that
-- was missing: it charges, it never overdraws, and a retry does not double bill.

\set QUIET on
set client_min_messages to notice;

do $$
declare
  u uuid := '11111111-1111-1111-1111-111111111111';
  st text; left_ integer;
begin
  insert into auth.users (id) values (u) on conflict do nothing;
  insert into public.profiles (id, credits) values (u, 10)
    on conflict (id) do update set credits = 10;

  -- charges the requested amount
  select status, credits_left into st, left_ from public.spend_credits(u, 3, 'bulk_enrich', 'ref-a');
  assert st = 'ok', 'expected ok, got ' || st;
  assert left_ = 7, 'expected 7 left, got ' || left_;
  raise notice 'PASS spend_credits takes the amount asked for';

  -- the ledger records it as a debit
  assert (select delta from public.credit_ledger where user_id = u and ref = 'ref-a') = -3,
    'ledger should record a negative delta';
  raise notice 'PASS the charge is recorded in the ledger as a debit';

  -- the same ref never charges twice
  select status, credits_left into st, left_ from public.spend_credits(u, 3, 'bulk_enrich', 'ref-a');
  assert st = 'already', 'expected already, got ' || st;
  assert left_ = 7, 'a retry must not charge again, got ' || left_;
  raise notice 'PASS a retried request settles on one charge';

  -- a different ref is a different piece of work
  select status, credits_left into st, left_ from public.spend_credits(u, 2, 'bulk_enrich', 'ref-b');
  assert st = 'ok' and left_ = 5, 'expected 5 left, got ' || left_;
  raise notice 'PASS a new run is charged separately';

  -- never overdraws
  select status, credits_left into st, left_ from public.spend_credits(u, 99, 'bulk_enrich', 'ref-c');
  assert st = 'insufficient', 'expected insufficient, got ' || st;
  assert left_ = 5, 'balance must not move, got ' || left_;
  assert (select credits from public.profiles where id = u) = 5, 'balance changed on a refused charge';
  raise notice 'PASS a charge larger than the balance is refused and changes nothing';

  -- charging nothing is a success, not an error
  select status, credits_left into st, left_ from public.spend_credits(u, 0, 'bulk_enrich', 'ref-d');
  assert st = 'ok' and left_ = 5, 'zero charge should succeed unchanged';
  raise notice 'PASS a run that enriched nothing charges nothing';

  -- spending exactly the balance is allowed
  select status, credits_left into st, left_ from public.spend_credits(u, 5, 'bulk_enrich', 'ref-e');
  assert st = 'ok' and left_ = 0, 'expected 0 left, got ' || left_;
  raise notice 'PASS the last credit can be spent';

  -- and then nothing more
  select status, credits_left into st, left_ from public.spend_credits(u, 1, 'bulk_enrich', 'ref-f');
  assert st = 'insufficient' and left_ = 0, 'empty balance must refuse';
  raise notice 'PASS an empty balance refuses the next charge';
end $$;
