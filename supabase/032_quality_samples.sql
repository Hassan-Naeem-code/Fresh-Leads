-- ---------------------------------------------------------------------------
-- 032. QUALITY SAMPLES  (measured accuracy, not claimed accuracy)
--
-- Every page of this site uses the words "verified", "confirmed active" and
-- "deliverable". Not one of them was measured. We could not have said how often a
-- number we verified stops working, because nothing ever went back and checked.
--
-- TWO SOURCES OF TRUTH, AND THEY ANSWER DIFFERENT QUESTIONS:
--
--   lead_reports (migration 031)  what customers TELL us went wrong.
--                                 Real, but biased: most people never report, and the
--                                 ones who do skew toward the worst experiences.
--
--   quality_samples (this table)  what WE find when we re-check a random sample of
--                                 leads customers actually paid for.
--                                 Unbiased, and the only number honest enough to
--                                 publish, because nobody had to choose to tell us.
--
-- The sample is drawn from UNLOCKED leads on purpose. Re-checking leads nobody bought
-- would measure a population no customer ever saw. What matters is the accuracy of
-- what we actually sold.
--
-- The point of the table is to be able to publish a number with a denominator next to
-- it. "97% of verified numbers still answered when we re-checked, across 412 leads
-- sampled in the last 30 days" is a claim a sceptical buyer can weigh. "Verified
-- leads" is an adjective.
-- ---------------------------------------------------------------------------

create table if not exists public.quality_samples (
  id          uuid primary key default gen_random_uuid(),
  -- The business, not the row: a sample is about a business we sold, and the same
  -- business may appear in many searches.
  lead_key    text not null,
  -- How long after the sale we looked. A number that dies after 90 days is a very
  -- different fact from one that was wrong when we sold it, and without this they are
  -- indistinguishable in the aggregate.
  age_days    integer not null,

  -- What we claimed at the time of sale.
  claimed_deliverable boolean not null,
  -- What we found on re-check. Null where the channel did not exist to begin with, so
  -- "no email to test" never counts as a failed email.
  phone_ok    boolean,
  email_ok    boolean,
  site_ok     boolean,
  -- The verdict: did the lead still hold up on the same test that let us sell it?
  still_good  boolean not null,
  checked_at  timestamptz not null default now(),

  -- The UTC day this sample was taken, purely so the uniqueness rule below can exist.
  --
  -- It is a stored generated column rather than an expression in the index, because
  -- `checked_at::date` is only STABLE: casting a timestamptz to a date reads the
  -- session's TimeZone setting, so the same row could index differently depending on
  -- who connected. Postgres rejects that outright (42P17), which is the correct call.
  --
  -- Pinning to UTC makes the expression immutable and, more importantly, makes the
  -- rule mean the same thing everywhere. The same discipline the credit code already
  -- applies to its month keys: a boundary that moves with the reader's timezone is a
  -- boundary that produces different answers for different people.
  checked_on  date generated always as ((checked_at at time zone 'UTC')::date) stored
);

create index if not exists quality_samples_recent_idx
  on public.quality_samples(checked_at desc);
-- One sample per business per day, so a re-run of the cron cannot inflate the
-- denominator with the same business twice and flatter the percentage.
create unique index if not exists quality_samples_daily_idx
  on public.quality_samples(lead_key, checked_on);

alter table public.quality_samples enable row level security;
-- Nobody reads this directly. It is aggregated by lib/quality.ts through the service
-- role and published as counts; the raw rows name businesses our customers bought and
-- are nobody else's business.
