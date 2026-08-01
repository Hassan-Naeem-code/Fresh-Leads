-- ---------------------------------------------------------------------------
-- 019. DETECTED CHANGES
--
-- Snapshots have been accumulating since migration 008 and the diff has been
-- running on every search, but the result was logged and thrown away. Nothing had
-- two observations yet, so there was nothing to keep.
--
-- There is now: 73 businesses have been seen on more than one day. This table is
-- where a detected change lands so it can outlive the request that found it, be
-- shown on the lead, and be summarised in a weekly email.
--
-- Keyed by BUSINESS, not by customer. A restaurant that dropped its booking system
-- dropped it for everybody; who cares about that fact is a separate question,
-- answered by joining against who has opened that lead.
-- ---------------------------------------------------------------------------

create table if not exists public.business_triggers (
  id          bigserial primary key,
  lead_key    text not null,
  -- site_went_down | site_recovered | vendor_switched | vendor_adopted |
  -- vendor_dropped | booking_added | booking_removed | lost_own_site | gained_own_site
  kind        text not null,
  -- The sentence a rep can say out loud, built at detection time from the vendor
  -- names as they were then. Stored rather than recomputed: vendor names change.
  label       text not null,
  -- The date of the observation we compared against, so the UI can say "since 30
  -- July" rather than implying we watched it happen.
  since       date not null,
  detected_on date not null default ((now() at time zone 'utc')::date),
  created_at  timestamptz not null default now()
);

-- One row per business per kind per day. A business searched by twenty customers on
-- the same day changed once, not twenty times.
create unique index if not exists business_triggers_unique
  on public.business_triggers (lead_key, kind, detected_on);

create index if not exists business_triggers_recent
  on public.business_triggers (detected_on desc);
create index if not exists business_triggers_lead
  on public.business_triggers (lead_key, detected_on desc);

alter table public.business_triggers enable row level security;
-- No policies. Read through the server, which joins against what the caller has
-- actually paid to open: the changes at a business are worth money, and handing the
-- whole table to any signed-in browser would give away the product.

-- ---------------------------------------------------------------------------
-- WHEN THE LAST DIGEST WENT OUT
--
-- On the profile rather than in its own table: it is one date per person, and the
-- send loop needs it in the same read as the preference it sits beside.
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists digest_sent_on date;
