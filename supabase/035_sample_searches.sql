-- ---------------------------------------------------------------------------
-- 035. PUBLIC SAMPLE SEARCHES
--
-- The landing page hero is a static mock (app/HeroMock.tsx). Everything else in this
-- product refuses to claim what it has not established, and then the first thing a
-- visitor sees is an invented result set. The fix is to run a real search, for a niche
-- and a city they choose, before they have an account.
--
-- WHY THIS TABLE EXISTS: a public endpoint that crawls is a public endpoint that
-- spends money. A sample fans out to Overpass and, when configured, to Google Places,
-- which bills per request. Without a cache, one person refreshing the landing page in a
-- loop is a bill, and a bored stranger is a bigger one.
--
-- So a sample is computed at most once per niche+city per day and served from here
-- afterwards. The rendered rows are stored, not the raw leads, because what is served
-- publicly must be exactly what was audited as safe to serve publicly and nothing that
-- happens later can widen it.
--
-- WHAT IS SAFE TO STORE HERE: the same shape a locked lead has inside the product
-- (lib/lead-view.ts toLockedLead), which is name, category, city, grade and freshness,
-- and specifically NOT phone, email or the need signals. Those are what a credit buys.
-- Storing them here would put the paid part of the product in a table read by an
-- endpoint with no authentication in front of it.
-- ---------------------------------------------------------------------------

create table if not exists public.sample_searches (
  -- Normalised "niche|location", the same shape lib/search-cache.ts uses.
  key         text primary key,
  niche       text not null,
  location    text not null,
  -- The resolved place name, so the page can say where it actually searched rather
  -- than echoing what was typed.
  area        text,
  -- The rendered, already-redacted rows. jsonb so the shape can change without a
  -- migration, exactly as leads.raw does.
  leads       jsonb not null,
  -- How many businesses discovery found in total, which is the honest headline: the
  -- three shown are the top of a real list, and saying so is the point.
  found       integer not null default 0,
  created_at  timestamptz not null default now()
);

create index if not exists sample_searches_created_idx
  on public.sample_searches(created_at desc);

alter table public.sample_searches enable row level security;
-- No policies: the service role reads and writes it, and the public endpoint is the
-- only way in. RLS on with no policy means a leaked anon key still reads nothing.
