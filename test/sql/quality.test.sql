-- quality_samples: the table the published accuracy number is computed from.
--
-- There is no function to test here, only a uniqueness rule, and that rule is the
-- whole integrity of the figure on /accuracy. If the same business can be sampled
-- twice in a day, a re-run of the cron inflates the denominator with businesses we
-- already counted and the percentage drifts toward whatever we sampled most often.
--
-- This file also exists because the index enforcing it shipped broken: it was written
-- as `(checked_at::date)`, which reads the session TimeZone and is therefore only
-- STABLE, and Postgres refuses it in an index (42P17). Nothing caught that, because
-- nothing here applied the migration.

\set QUIET on
set client_min_messages to notice;

do $$
declare
  n integer;
begin
  insert into public.quality_samples (lead_key, age_days, claimed_deliverable, still_good)
  values ('osm:node/77', 3, true, true);

  -- Same business, same day, second run of the cron.
  begin
    insert into public.quality_samples (lead_key, age_days, claimed_deliverable, still_good)
    values ('osm:node/77', 3, true, false);
    assert false, 'the same business must not be sampled twice in one day';
  exception when unique_violation then
    raise notice 'PASS a business cannot be sampled twice in the same day';
  end;

  -- A different day is a legitimate second observation: the question "does this lead
  -- still hold up" has a new answer every day, and the trend is the point.
  insert into public.quality_samples (lead_key, age_days, claimed_deliverable, still_good, checked_at)
  values ('osm:node/77', 4, true, false, now() - interval '1 day');
  select count(*) into n from public.quality_samples where lead_key = 'osm:node/77';
  assert n = 2, 'a sample on another day should be allowed, got ' || n;
  raise notice 'PASS the same business can be sampled again on a different day';

  -- The day is pinned to UTC, not to whoever happens to be connected. A boundary that
  -- moves with the reader's timezone gives different people different denominators.
  set local timezone to 'Pacific/Kiritimati';   -- UTC+14
  begin
    insert into public.quality_samples (lead_key, age_days, claimed_deliverable, still_good)
    values ('osm:node/77', 3, true, true);
    assert false, 'the daily rule must not depend on the session timezone';
  exception when unique_violation then
    raise notice 'PASS the daily rule is anchored to UTC, not the session timezone';
  end;
  reset timezone;

  -- Nulls are allowed on the per-channel columns, and they have to be: a business with
  -- no email address must never be recorded as an email that failed.
  insert into public.quality_samples
    (lead_key, age_days, claimed_deliverable, phone_ok, email_ok, still_good)
  values ('osm:node/78', 1, true, true, null, true);
  assert (select email_ok from public.quality_samples where lead_key = 'osm:node/78') is null,
    'a channel that did not exist must stay null, not false';
  raise notice 'PASS a channel we never had is recorded as unknown, not as a failure';
end $$;
