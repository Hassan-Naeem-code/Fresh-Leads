-- HIRING, REMEMBERED ACROSS SEARCHES
--
-- A third of local businesses are actively hiring, and it is the strongest signal we
-- collect that a business has budget and is growing. It was discovered by the
-- enrichment crawl, shown once on the opened lead, and then thrown away: nothing
-- scored it, and the next search on the same business started from nothing.
--
-- It cannot simply move into the search path. Finding it means fetching a careers page
-- per business, and the search already runs 40 audits inside a 60 second function. So
-- it stays where it is paid for, at unlock, and is REMEMBERED here, which means the
-- next search that meets this business gets the signal for free. Coverage compounds
-- with use instead of being rediscovered every time.
--
-- Why not a column on audit_cache: that row is upserted wholesale by the audit writer
-- on every crawl, which would wipe a hiring fact that took a paid enrichment to learn.
-- Separate writers, separate tables.
--
-- What this is NOT: it holds no contact details and no owner name. Those are what a
-- credit buys and they stay on the customer's own lead row. This is a fact about the
-- world, like the audit cache beside it, and it only ever moves a grade.
create table if not exists public.hiring_signals (
  -- The site's hostname, matching audit_cache, so one business is one row however
  -- many customers meet it.
  host        text primary key,
  hiring      boolean not null,
  -- The careers page we found, so the opened lead can link straight to it.
  hiring_url  text,
  checked_at  timestamptz not null default now(),
  -- Hiring goes stale faster than a website does. A role filled two months ago is not
  -- a reason to call, so a stale row is refreshed rather than served.
  expires_at  timestamptz not null
);

create index if not exists hiring_signals_expiry on public.hiring_signals (expires_at);

alter table public.hiring_signals enable row level security;
-- No policies: service role only, same as the caches in 022. Our data about the world,
-- not a customer's data about their prospects.

-- Housekeeping rides along with the existing sweep, since Vercel Hobby allows two cron
-- jobs and both are spoken for.
create or replace function public.purge_expired_hiring_signals()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  removed integer;
begin
  delete from public.hiring_signals where expires_at < now() - interval '30 days';
  get diagnostics removed = row_count;
  return removed;
end;
$$;

revoke all on function public.purge_expired_hiring_signals() from public, anon, authenticated;
