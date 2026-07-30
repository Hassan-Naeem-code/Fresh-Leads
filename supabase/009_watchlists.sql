-- ---------------------------------------------------------------------------
-- 009. WATCHLISTS (the reason to come back next week)
--
-- A search that is run once and thrown away is a tool. A market you are watching,
-- that tells you what is new and what changed since you last looked, is a service.
-- That difference is most of why anyone renews a lead subscription.
--
-- saved_searches already existed in schema.sql and was never wired to anything. It is
-- extended here rather than replaced, so any rows that do exist survive.
--
-- The companion table watchlist_seen is what makes "new" mean anything: without a
-- record of which businesses this watchlist has already shown, every re-run would
-- present the same list and call all of it new.
-- ---------------------------------------------------------------------------

alter table public.saved_searches
  -- What the user calls it. Defaults to "niche in location" when they do not say.
  add column if not exists name text,
  -- The buyer lens the results are graded through (lib/playbooks.ts).
  add column if not exists playbook text,
  -- Optional problem filter (lib/problems.ts), so a watchlist can be narrow.
  add column if not exists problem text,
  add column if not exists last_run_at timestamptz,
  -- Cheap counter for the list view, so it does not have to count rows per card.
  add column if not exists last_new_count integer not null default 0;

-- ---------------------------------------------------------------------------
-- WHAT THIS WATCHLIST HAS ALREADY SHOWN
--
-- Keyed on lead_key ("<source>:<source_id>"), the cross-search identity of the
-- business, NOT the leads row id: the same business found again next week is a new
-- row, and re-presenting it as a fresh discovery would make "new" worthless.
-- ---------------------------------------------------------------------------
create table if not exists public.watchlist_seen (
  saved_search_id uuid not null references public.saved_searches(id) on delete cascade,
  lead_key        text not null,
  first_seen_at   timestamptz not null default now(),
  primary key (saved_search_id, lead_key)
);

create index if not exists watchlist_seen_search_idx
  on public.watchlist_seen (saved_search_id, first_seen_at desc);

alter table public.watchlist_seen enable row level security;

-- Readable by the owner of the parent watchlist. Writes go through the service role,
-- because marking a business as seen decides whether it is ever announced as new, and
-- that is not something a browser should be able to edit.
drop policy if exists watchlist_seen_select_own on public.watchlist_seen;
create policy watchlist_seen_select_own on public.watchlist_seen
  for select using (
    exists (
      select 1 from public.saved_searches s
      where s.id = watchlist_seen.saved_search_id and s.user_id = auth.uid()
    )
  );

-- saved_searches predates the RLS conventions used elsewhere, so make sure a user can
-- only ever see and manage their own.
alter table public.saved_searches enable row level security;

drop policy if exists saved_searches_select_own on public.saved_searches;
create policy saved_searches_select_own on public.saved_searches
  for select using (auth.uid() = user_id);

drop policy if exists saved_searches_insert_own on public.saved_searches;
create policy saved_searches_insert_own on public.saved_searches
  for insert with check (auth.uid() = user_id);

drop policy if exists saved_searches_update_own on public.saved_searches;
create policy saved_searches_update_own on public.saved_searches
  for update using (auth.uid() = user_id);

drop policy if exists saved_searches_delete_own on public.saved_searches;
create policy saved_searches_delete_own on public.saved_searches
  for delete using (auth.uid() = user_id);
