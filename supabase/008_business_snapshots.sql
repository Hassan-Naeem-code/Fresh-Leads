-- ---------------------------------------------------------------------------
-- 008. BUSINESS SNAPSHOTS (the change-over-time signal store)
--
-- Every warm signal worth selling is a DIFF: a business that switched POS vendor,
-- whose site went down last week, that just added online booking, that started
-- hiring. A single live search cannot produce any of those, because a diff needs a
-- previous observation to compare against. This table is that previous observation.
--
-- It stores nothing we did not observe ourselves. Every column here comes from our
-- own fetch of the business's own homepage (lib/audit.ts), which is our data to keep.
--
-- DELIBERATELY ABSENT: business name, address, rating, review count, photos, hours.
-- Those are Google Places content, and the Maps Platform terms permit caching only
-- the place id (indefinitely) and coordinates (30 days). Keeping any of the rest
-- would put the whole product in breach, so the discovery record stays live-only and
-- this table holds crawl observations alone.
--
-- Growth is bounded by one snapshot per business per day (see captured_on below).
-- Ten thousand tracked businesses crawled daily is ~3.6M rows a year, which is
-- comfortable for Postgres and cheap to prune by captured_on.
-- ---------------------------------------------------------------------------

create table if not exists public.business_snapshots (
  id           bigserial primary key,

  -- Stable cross-search identity of the business, "<source>:<source_id>". For a
  -- Places-sourced lead the source_id is the place id, which is the one Places
  -- field we are allowed to retain indefinitely.
  lead_key     text not null,

  -- The hostname we actually fetched. Kept so a re-crawl can find the same site
  -- again, and so a business that moves domain reads as a new site rather than a
  -- silently different one.
  site_host    text,

  captured_at  timestamptz not null default now(),

  -- One row per business per UTC day. Without this, a popular city searched by
  -- twenty customers would write twenty identical snapshots and the diff would
  -- compare a business against itself an hour earlier.
  captured_on  date generated always as ((captured_at at time zone 'utc')::date) stored,

  -- --- our own crawl observations ------------------------------------------
  reachable      boolean,
  -- own_domain | social_only | marketplace_only | none  (lib/website-kind.ts)
  website_kind   text,
  has_ssl        boolean,
  mobile_friendly boolean,
  has_booking    boolean,
  has_schema     boolean,
  has_analytics  boolean,
  load_ms        integer,
  word_count     integer,
  script_count   integer,
  copyright_year integer,
  -- Sorted vendor ids from lib/vendors.ts, e.g. {"spoton","opentable"}. Sorted so a
  -- set comparison is a plain array equality and detection order cannot fake a change.
  vendor_ids     text[]
);

-- The one-per-day guarantee. Writers use "on conflict do nothing", so the first
-- search of the day records the business and the rest are free no-ops.
create unique index if not exists business_snapshots_daily_idx
  on public.business_snapshots (lead_key, captured_on);

-- The read path: "give me the most recent snapshot before today for these leads".
create index if not exists business_snapshots_key_time_idx
  on public.business_snapshots (lead_key, captured_at desc);

-- Service-role only. This is operational crawl data, not user data: it belongs to no
-- customer, and no customer may read it directly. Enabling RLS with no policies is
-- what makes that true, since the service-role key bypasses RLS and nothing else does.
alter table public.business_snapshots enable row level security;
