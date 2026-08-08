-- ---------------------------------------------------------------------------
-- 033. SEARCH RELIABILITY METRICS
--
-- The search route already measures itself. app/api/leads/route.ts stamps a timing at
-- every stage and counts what each budget had to skip, and then throws all of it away
-- when the response is sent. Every budget in that file was tuned by guessing which
-- stage was slow, tightening it, and watching whether the next manual search felt
-- better. That worked until it did not, because the remaining cost was spread across
-- stages nobody was timing.
--
-- The three numbers that decide whether the product feels reliable, none of which we
-- could previously answer:
--
--   p95 duration    A search that usually takes 9 seconds and occasionally takes 45
--                   is experienced as a 45 second product, because that is the one
--                   people remember and screenshot.
--
--   zero rate       How often a search returns nothing. This is the single most
--                   damaging outcome: it reads as a broken product even when the area
--                   genuinely has no such businesses, and we had no idea how often it
--                   happened or for which niches.
--
--   degraded rate   How often we returned real results but had to skip work to do it,
--                   e.g. websites the audit budget could not reach. Those leads are
--                   graded on contact details only, which is honest and disclosed, but
--                   a product where that is the common case is a different product
--                   from one where it is rare.
--
-- Stored on `searches` rather than in a new table: one row per search already exists,
-- it is already written on the response path, and a second table would need its own
-- write, its own failure mode, and a join to be useful.
-- ---------------------------------------------------------------------------

alter table public.searches
  -- Wall clock for the whole request, in ms.
  add column if not exists duration_ms      integer,
  -- How many businesses discovery found, before any filtering.
  add column if not exists discovered       integer,
  -- How many were actually returned to the customer.
  add column if not exists returned         integer,
  -- Websites the audit budget could not reach in time. The honest degradation signal.
  add column if not exists audits_skipped   integer,
  -- Per-stage timings, exactly as the route already computes them. Kept as jsonb
  -- rather than as columns so adding a stage needs no migration, which is the same
  -- reasoning that keeps the full lead in leads.raw.
  add column if not exists stage_ms         jsonb;

-- The reliability query is "recent searches, by time", so that is the index.
create index if not exists searches_scanned_idx on public.searches(scanned_at desc);
