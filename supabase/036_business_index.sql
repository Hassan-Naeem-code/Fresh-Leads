-- ---------------------------------------------------------------------------
-- 036. THE OWNED BUSINESS INDEX
--
-- Every search currently rebuilds its own answer: Overpass is asked which businesses
-- are in an area, live, on every cache miss. That is the slowest and least reliable
-- stage in the product. It is on an 11 second budget, it is a free public service that
-- rate-limits under load, and when it does not answer the search silently returns
-- fewer businesses.
--
-- This is that stage, precomputed and owned.
--
-- WHAT THIS INDEX MAY AND MAY NOT CONTAIN, and it is a licensing question rather than
-- a technical one:
--
--   OpenStreetMap   ODbL. Storable, redistributable, ours to index. This is the whole
--                   of the table below.
--   Google Places   NOT STORABLE beyond a place id and coordinates. Their terms are
--                   explicit and app/api/leads/route.ts has always honoured them.
--                   Places therefore stays a LIVE call on every search, enriching the
--                   page of results we actually show rather than filling this table.
--
-- So the index replaces the slow half and leaves the licensed half alone. That is not
-- a compromise: Overpass was the stage that made searches slow and flaky, and Places
-- was never the bottleneck.
--
-- WHAT IT BUYS, concretely:
--   latency     a bbox query against a local table instead of a foreign HTTP call
--   reliability no third party to be slow, rate-limit us, or return nothing
--   volume      the 250-lead ceiling exists because discovery is expensive per search.
--               Reading an index is not, so the ceiling can move.
-- ---------------------------------------------------------------------------

-- Fuzzy name matching, for the fallback path where a niche has no tag convention and
-- lib/niche.ts searches business names instead (chiropractors, towing, solar).
create extension if not exists pg_trgm;

create table if not exists public.indexed_businesses (
  -- The OSM identity, "node/123456". Stable across imports, so a re-ingest updates a
  -- business rather than duplicating it.
  osm_id        text primary key,
  name          text not null,
  /**
   * The single category label the pipeline uses, derived the same way
   * lib/sources/overpass-source.ts derives it, so an indexed lead and a live one
   * cannot disagree about what a business is.
   */
  category      text,
  -- EVERY TAG, verbatim. Storing the whole tag set rather than the handful we read
  -- today means a new niche, a new filter or a new signal needs a query change and not
  -- a re-ingest of several million rows. Disk is far cheaper than a re-import.
  tags          jsonb not null default '{}'::jsonb,
  lat           double precision not null,
  lon           double precision not null,
  phone         text,
  website       text,
  email         text,
  address       text,
  city          text,
  -- When OSM itself last saw an edit. This is the freshness signal the product already
  -- sells, carried through the index rather than lost by it.
  osm_updated   timestamptz,
  -- Which ingested area this row came from, and when we wrote it.
  metro         text not null,
  indexed_at    timestamptz not null default now()
);

-- THE QUERY THIS TABLE EXISTS TO SERVE: everything inside a bounding box. A composite
-- btree on the two coordinates answers it directly. PostGIS would be needed for true
-- radius search and is available on Supabase, but geocode() already hands us a bbox,
-- so adding an extension to answer a question we do not ask would be cost with no gain.
create index if not exists indexed_businesses_bbox_idx
  on public.indexed_businesses(lat, lon);
-- Tag matching, the index equivalent of an Overpass selector. GIN over jsonb makes
-- `tags @> '{"shop":"bakery"}'` fast without a column per tag.
create index if not exists indexed_businesses_tags_idx
  on public.indexed_businesses using gin(tags);
-- The name-match fallback for niches with no tag convention.
create index if not exists indexed_businesses_name_trgm_idx
  on public.indexed_businesses using gin(name gin_trgm_ops);
create index if not exists indexed_businesses_metro_idx
  on public.indexed_businesses(metro);

alter table public.indexed_businesses enable row level security;
-- No policies. This is read through the service role by the search pipeline; it is not
-- user data and nobody queries it directly.

-- ---------------------------------------------------------------------------
-- WHICH AREAS ARE INDEXED, AND HOW STALE
--
-- The most important table here, and the one that keeps the index honest.
--
-- An index that does not know its own coverage is worse than no index: a search for a
-- city we never ingested would return zero businesses and look like a broken product,
-- when the truth is simply that we hold nothing there. So coverage is recorded
-- explicitly, and the search only trusts the index for an area listed here and still
-- fresh. Everywhere else falls through to the live sources exactly as it does today.
--
-- This is the same rule as `websiteKnown` and `siteAudited` elsewhere in the codebase:
-- absence of data must never be presented as evidence of absence.
-- ---------------------------------------------------------------------------
create table if not exists public.indexed_areas (
  metro         text primary key,
  -- The bbox actually ingested, so a search can tell whether its area is inside.
  south         double precision not null,
  north         double precision not null,
  west          double precision not null,
  east          double precision not null,
  -- How many rows the last ingest wrote. A metro that ingested 4 businesses is a
  -- failed ingest wearing a success badge, and this is what makes that visible.
  business_count integer not null default 0,
  last_ingested timestamptz,
  -- Set while an ingest is running so a second one cannot start on the same metro.
  ingesting     boolean not null default false,
  created_at    timestamptz not null default now()
);

alter table public.indexed_areas enable row level security;

-- ---------------------------------------------------------------------------
-- UPSERT ONE BATCH
--
-- Ingestion writes in chunks, and a chunk that partially fails must not leave the
-- metro half-written with a fresh timestamp. The count and the timestamp are therefore
-- only moved by finish_ingest below, once every chunk has landed.
-- ---------------------------------------------------------------------------
create or replace function public.finish_ingest(
  p_metro text,
  p_count integer
)
returns void
language sql
security definer
set search_path = public
as $$
  update public.indexed_areas
     set business_count = p_count,
         last_ingested  = now(),
         ingesting      = false
   where metro = p_metro;
$$;

revoke all on function public.finish_ingest(text, integer) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- THE SEARCH
--
-- One question: which indexed businesses sit inside this box and match any of these
-- tag selectors. The selectors arrive as jsonb, already parsed from Overpass syntax by
-- lib/index-filters.ts, in the shape:
--
--   [{"key":"shop","value":"bakery","extra_key":"name","extra_pattern":"gluten"}]
--
-- NO DYNAMIC SQL. The obvious way to write this is to build a WHERE clause per filter
-- and EXECUTE it, which puts customer-derived strings into query text. Iterating the
-- filters as DATA instead keeps every value a parameter, so a tag name can never
-- become syntax. The pattern still reaches a regex engine, which is why
-- lib/index-filters.ts refuses anything but plain alternations before we get here.
-- ---------------------------------------------------------------------------
create or replace function public.search_index(
  p_south   double precision,
  p_north   double precision,
  p_west    double precision,
  p_east    double precision,
  p_filters jsonb,
  p_limit   integer
)
returns setof public.indexed_businesses
language sql
stable
security definer
set search_path = public
as $$
  select b.*
    from public.indexed_businesses b
   where b.lat between p_south and p_north
     and b.lon between p_west  and p_east
     and exists (
       select 1
         from jsonb_array_elements(p_filters) f
        where
          -- The tag itself: an exact value, or "any value" for the fallback shape.
          (
            (f->>'value' is null and b.tags ? (f->>'key'))
            or b.tags->>(f->>'key') = f->>'value'
          )
          -- The optional secondary constraint. "name" reads the column, because that
          -- is where the trigram index lives; anything else reads the tag.
          and (
            f->>'extra_key' is null
            or (
              case when f->>'extra_key' = 'name' then b.name
                   else b.tags->>(f->>'extra_key') end
            ) ~* (f->>'extra_pattern')
          )
     )
   -- Busiest-looking first is not available here (OSM has no review counts), so the
   -- order is stable rather than meaningful: the pipeline re-ranks everything anyway.
   order by b.osm_id
   limit greatest(1, least(p_limit, 2000));
$$;

revoke all on function public.search_index(double precision, double precision, double precision, double precision, jsonb, integer) from public, anon, authenticated;
