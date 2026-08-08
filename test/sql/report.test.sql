-- report_lead: the credit-back that makes our guarantee invocable.
--
-- This function hands money BACK, which makes it the one place in the schema where a
-- bug pays out rather than overcharging. Everything asserted here is a way it could be
-- made to pay twice, or to refuse a customer who is owed.

\set QUIET on
set client_min_messages to notice;

do $$
declare
  u  uuid := '22222222-2222-2222-2222-222222222222';
  v  uuid := '33333333-3333-3333-3333-333333333333';
  st text; back integer; left_ integer;
begin
  insert into auth.users (id) values (u), (v) on conflict do nothing;
  insert into public.profiles (id, credits) values (u, 5), (v, 5)
    on conflict (id) do update set credits = 5;

  -- A lead they bought.
  insert into public.lead_unlocks (user_id, lead_key) values (u, 'osm:node/1');

  -- ---------------------------------------------------------------------
  select status, refunded, credits_left into st, back, left_
    from public.report_lead(u, 'osm:node/1', 'wrong_number', 'rang a nail salon');
  assert st = 'refunded', 'expected refunded, got ' || st;
  assert back = 1, 'expected 1 credit back, got ' || back;
  assert left_ = 6, 'expected balance 6, got ' || left_;
  raise notice 'PASS a reported lead refunds the credit';

  assert (select delta from public.credit_ledger
           where user_id = u and reason = 'lead_refund' and ref = 'osm:node/1') = 1,
    'the refund must appear in the ledger as a credit';
  raise notice 'PASS the refund is recorded in the ledger';

  -- THE UNLOCK SURVIVES. They keep what they were refunded for: taking it back would
  -- save nothing, since they have already read it, and would re-expose them to being
  -- charged again by a later search.
  assert exists (select 1 from public.lead_unlocks where user_id = u and lead_key = 'osm:node/1'),
    'the unlock must survive a refund';
  raise notice 'PASS the customer keeps the lead they were refunded for';

  -- ---------------------------------------------------------------------
  -- A second report on the same business must never pay again.
  select status, refunded, credits_left into st, back, left_
    from public.report_lead(u, 'osm:node/1', 'closed', null);
  assert st = 'already', 'expected already, got ' || st;
  assert back = 0, 'a repeat report must refund nothing, got ' || back;
  assert left_ = 6, 'balance moved on a repeat report, got ' || left_;
  raise notice 'PASS the same business cannot be refunded twice';

  -- ---------------------------------------------------------------------
  -- Reporting something they never paid for is recorded, but pays nothing. This is the
  -- shape an abuser would try: report every business in a city and collect.
  select status, refunded, credits_left into st, back, left_
    from public.report_lead(u, 'osm:node/999', 'closed', null);
  assert st = 'not_charged', 'expected not_charged, got ' || st;
  assert back = 0, 'a lead never bought must refund nothing, got ' || back;
  assert left_ = 6, 'balance moved on an unpaid lead, got ' || left_;
  assert exists (select 1 from public.lead_reports where user_id = u and lead_key = 'osm:node/999'),
    'the report is still recorded, because it is data about our accuracy';
  raise notice 'PASS reporting a lead you never bought pays nothing but is still recorded';

  -- ---------------------------------------------------------------------
  -- The owner reveal is a separate charge, so "wrong person" has to give back both.
  insert into public.lead_unlocks (user_id, lead_key) values (v, 'osm:node/2');
  insert into public.owner_unlocks (user_id, lead_key) values (v, 'osm:node/2');

  select status, refunded, credits_left into st, back, left_
    from public.report_lead(v, 'osm:node/2', 'not_owner', null);
  assert st = 'refunded', 'expected refunded, got ' || st;
  assert back = 2, 'wrong owner must refund the lead AND the owner reveal, got ' || back;
  assert left_ = 7, 'expected balance 7, got ' || left_;
  raise notice 'PASS a wrong owner refunds the separate owner reveal too';

  -- ---------------------------------------------------------------------
  -- A different reason on a lead with an owner unlock refunds only the lead.
  insert into public.lead_unlocks (user_id, lead_key) values (v, 'osm:node/3');
  insert into public.owner_unlocks (user_id, lead_key) values (v, 'osm:node/3');
  select status, refunded into st, back
    from public.report_lead(v, 'osm:node/3', 'wrong_number', null);
  assert back = 1, 'only a wrong owner refunds the owner credit, got ' || back;
  raise notice 'PASS other reasons do not refund the owner reveal';

  -- ---------------------------------------------------------------------
  -- Outside the window: recorded, not refunded.
  insert into public.lead_unlocks (user_id, lead_key, unlocked_at)
    values (v, 'osm:node/4', now() - interval '90 days');
  select status, refunded into st, back
    from public.report_lead(v, 'osm:node/4', 'closed', null);
  assert st = 'expired', 'expected expired, got ' || st;
  assert back = 0, 'an expired report must refund nothing, got ' || back;
  assert exists (select 1 from public.lead_reports where user_id = v and lead_key = 'osm:node/4'),
    'an expired report is still recorded';
  raise notice 'PASS a report outside the window is recorded but not refunded';

  -- ---------------------------------------------------------------------
  -- The reason vocabulary is closed, so the counts stay countable.
  begin
    insert into public.lead_reports (user_id, lead_key, reason) values (u, 'osm:node/5', 'made_up');
    assert false, 'an unknown reason should have been rejected';
  exception when check_violation then
    raise notice 'PASS an unknown reason is refused by the database';
  end;
end $$;
