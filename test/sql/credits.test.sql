\set ON_ERROR_STOP on
\pset footer off
create or replace function assert_eq(label text, got anyelement, want anyelement)
returns void language plpgsql as $$
begin
  if got::text is distinct from want::text then
    raise exception 'FAIL  % : got %, want %', label, got, want;
  else
    raise notice 'PASS  % (%)', label, got;
  end if;
end $$;

insert into auth.users (id, email) values ('11111111-1111-1111-1111-111111111111','a@x.com');
insert into public.profiles (id, email) values ('11111111-1111-1111-1111-111111111111','a@x.com');
\set U '''11111111-1111-1111-1111-111111111111'''

-- Signup bonus
select assert_eq('signup bonus grants 3', grant_credits(:U, 3, 'signup_bonus', :U), 3);
-- Idempotent: the same bonus can never be granted twice.
select assert_eq('signup bonus is idempotent', grant_credits(:U, 3, 'signup_bonus', :U), 3);

-- Purchase, idempotent on the Stripe session id (webhook redelivery).
select assert_eq('purchase of 10 credits', grant_credits(:U, 10, 'purchase', 'cs_test_1'), 13);
select assert_eq('redelivered webhook grants nothing', grant_credits(:U, 10, 'purchase', 'cs_test_1'), 13);
select assert_eq('a DIFFERENT session does grant', grant_credits(:U, 5, 'purchase', 'cs_test_2'), 18);

-- Unlock: spends exactly one credit.
select assert_eq('first unlock spends 1', (select status from unlock_lead(:U,'osm:node/1')), 'unlocked');
select assert_eq('balance after unlock', (select credits from profiles where id = :U), 17);
-- Re-unlocking the SAME business must be free forever.
select assert_eq('re-unlock is free', (select status from unlock_lead(:U,'osm:node/1')), 'already');
select assert_eq('balance unchanged by re-unlock', (select credits from profiles where id = :U), 17);

-- Export: charges only for the leads still locked.
select assert_eq('bulk charges only locked ones',
  (select charged from unlock_leads_bulk(:U, array['osm:node/1','osm:node/2','osm:node/3'])), 2);
select assert_eq('balance after export', (select credits from profiles where id = :U), 15);
-- Exporting the same set again costs nothing.
select assert_eq('re-export is free',
  (select charged from unlock_leads_bulk(:U, array['osm:node/1','osm:node/2','osm:node/3'])), 0);
select assert_eq('balance unchanged by re-export', (select credits from profiles where id = :U), 15);
-- Duplicate keys in one batch are charged once.
select assert_eq('duplicate keys charged once',
  (select charged from unlock_leads_bulk(:U, array['osm:node/9','osm:node/9','osm:node/9'])), 1);

-- Spend down to zero, then prove nothing goes negative.
select assert_eq('drain to zero', (select charged from unlock_leads_bulk(:U,
  (select array_agg('k'||g) from generate_series(1,14) g))), 14);
select assert_eq('balance is zero', (select credits from profiles where id = :U), 0);
select assert_eq('unlock with no credits is refused', (select status from unlock_lead(:U,'osm:node/99')), 'insufficient');
select assert_eq('nothing was unlocked', (select count(*)::int from lead_unlocks where lead_key='osm:node/99'), 0);
select assert_eq('balance still zero', (select credits from profiles where id = :U), 0);

-- Export that cannot be fully afforded is refused OUTRIGHT, not partially.
select assert_eq('grant 2 for partial test', grant_credits(:U, 2, 'purchase', 'cs_test_3'), 2);
select assert_eq('unaffordable export refused',
  (select status from unlock_leads_bulk(:U, array['p1','p2','p3'])), 'insufficient');
select assert_eq('  nothing charged', (select credits from profiles where id = :U), 2);
select assert_eq('  nothing unlocked', (select count(*)::int from lead_unlocks where lead_key in ('p1','p2','p3')), 0);

-- Ledger reconciles against the balance.
select assert_eq('ledger sums to balance',
  (select sum(delta)::int from credit_ledger where user_id = :U),
  (select credits from profiles where id = :U));

-- Subscription upsert + never shortening a paid period.
select upsert_subscription(:U,'sub_1','cus_1','active','2027-07-29'::timestamptz,false);
select assert_eq('subscription active', (select status from subscriptions where user_id = :U), 'active');
select upsert_subscription(:U,'sub_1','cus_1','active','2026-08-01'::timestamptz,false);
select assert_eq('out-of-order webhook cannot shorten access',
  (select current_period_end from subscriptions where user_id = :U), '2027-07-29'::timestamptz);
-- A genuine renewal DOES move the period forward.
select upsert_subscription(:U,'sub_1','cus_1','active','2028-07-29'::timestamptz,false);
select assert_eq('renewal advances the period',
  (select current_period_end from subscriptions where user_id = :U), '2028-07-29'::timestamptz);
-- Cancellation is recorded without touching the paid-through date.
select upsert_subscription(:U,'sub_1','cus_1','canceled','2028-07-29'::timestamptz,true);
select assert_eq('cancellation recorded', (select status from subscriptions where user_id = :U), 'canceled');
select assert_eq('paid-through date survives cancellation',
  (select current_period_end from subscriptions where user_id = :U), '2028-07-29'::timestamptz);

-- The hard floor: the DB itself rejects a negative balance.
do $$
begin
  update profiles set credits = -1 where id = '11111111-1111-1111-1111-111111111111';
  raise exception 'FAIL  negative balance was allowed';
exception when check_violation then
  raise notice 'PASS  negative balance rejected by constraint';
end $$;
