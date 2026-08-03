-- ---------------------------------------------------------------------------
-- 022. CACHING THE SLOW, SHARED PARTS OF A SEARCH
--
-- A search spends its time on two things, and neither of them is about the person
-- searching:
--
--   discovery    asking OpenStreetMap what businesses are in an area   ~14s
--   auditing     fetching each business's website and reading it        ~22s
--
-- "Dentists in Austin" returns the same businesses whoever asks, and their websites
-- do not change between two people searching an hour apart. Both are worth keeping.
--
-- WHAT IS DELIBERATELY NOT CACHED
--
--   Google Places content. Their terms permit storing place_id indefinitely and
--   coordinates for 30 days, and nothing else. So the discovery cache holds OSM rows
--   only, and a search still calls Places live. That costs some speed and keeps us on
--   the right side of an agreement we cannot afford to breach.
--
--   Paid verification. Twilio and ZeroBounce run when a credit is spent, every time,
--   and their results are already stored per lead. "We check the phone and the mailbox
--   before charging you" has to stay literally true.
--
--   Scoring. The same business scores differently for different customers, because the
--   playbook decides which signals count. Caching a grade would hand a web designer a
--   POS reseller's opinion.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. DISCOVERY: which businesses are in an area
-- ---------------------------------------------------------------------------
create table if not exists public.search_cache (
  -- Normalised "<niche>|<area>", lowercased and collapsed, so "Dentists" in
  -- "Austin, TX" and "dentists" in "austin,tx" are one entry rather than two.
  cache_key    text primary key,
  niche        text not null,
  area         text not null,
  -- OSM rows only. See the note above about Places.
  payload      jsonb not null,
  lead_count   integer not null default 0,
  -- Counted so the refresher can spend its budget on what people actually search.
  hit_count    integer not null default 0,
  created_at   timestamptz not null default now(),
  refreshed_at timestamptz not null default now(),
  expires_at   timestamptz not null
);

create index if not exists search_cache_expiry on public.search_cache (expires_at);
-- The refresher wants the popular entries that are closest to going stale.
create index if not exists search_cache_refresh on public.search_cache (hit_count desc, refreshed_at);

alter table public.search_cache enable row level security;
-- No policies. Service role only: this is our data about the world, not a customer's
-- data about their prospects, and a browser has no reason to read it directly.

-- ---------------------------------------------------------------------------
-- 2. AUDITS: what a business's website looked like
--
-- Keyed by HOST rather than by business, because two businesses sharing a domain
-- share a website, and because a business that moves domain should read as a new
-- site rather than as a changed one.
-- ---------------------------------------------------------------------------
create table if not exists public.audit_cache (
  host         text primary key,
  audit        jsonb not null,
  -- Kept separately from the payload so a query can select unreachable sites without
  -- unpacking every stored audit.
  reachable    boolean,
  hit_count    integer not null default 0,
  refreshed_at timestamptz not null default now(),
  expires_at   timestamptz not null
);

create index if not exists audit_cache_expiry on public.audit_cache (expires_at);
create index if not exists audit_cache_refresh on public.audit_cache (hit_count desc, refreshed_at);

alter table public.audit_cache enable row level security;
-- No policies, same reasoning.

-- ---------------------------------------------------------------------------
-- 3. COUNTING A HIT
--
-- One statement, so two searches at once cannot both read 4 and both write 5. The
-- count is what decides which entries are worth refreshing, so an undercount quietly
-- starves the popular ones.
-- ---------------------------------------------------------------------------
create or replace function public.touch_search_cache(p_key text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.search_cache set hit_count = hit_count + 1 where cache_key = p_key;
$$;

create or replace function public.touch_audit_cache(p_hosts text[])
returns void
language sql
security definer
set search_path = public
as $$
  update public.audit_cache set hit_count = hit_count + 1 where host = any(p_hosts);
$$;

revoke all on function public.touch_search_cache(text) from public, anon, authenticated;
revoke all on function public.touch_audit_cache(text[]) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. HOUSEKEEPING
--
-- An expired entry is never served, so it is only taking up space. Removed by the
-- daily job alongside the other purges.
-- ---------------------------------------------------------------------------
create or replace function public.purge_expired_cache()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare removed integer; total integer := 0;
begin
  -- A week past expiry, not on expiry: a stale entry is still worth serving while a
  -- refresh is in flight, and deleting on the dot would throw that away.
  delete from public.search_cache where expires_at < now() - interval '7 days';
  get diagnostics removed = row_count; total := total + removed;

  delete from public.audit_cache where expires_at < now() - interval '7 days';
  get diagnostics removed = row_count; total := total + removed;

  return total;
end;
$$;

revoke all on function public.purge_expired_cache() from public, anon, authenticated;
