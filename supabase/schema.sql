-- Fresh Leads — full database schema (run once in the Supabase SQL editor).
-- Safe to re-run: guarded with "if not exists" / "drop ... if exists" where practical.
--
-- Security model: RLS is ON for every table. Users can read/write their OWN rows for
-- profiles/business_profiles/saved_searches. Money & entitlement tables (quotes, orders)
-- are READ-ONLY to users — all privileged writes go through the service-role key
-- (Stripe webhook + quote engine), which bypasses RLS. This means a client can never
-- self-grant access or inflate a quota.

-- ---------------------------------------------------------------------------
-- 1. PROFILES  (1:1 with auth.users, auto-created on signup)
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id                 uuid primary key references auth.users(id) on delete cascade,
  email              text,
  full_name          text,
  company_name       text,
  stripe_customer_id text unique,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 2. BUSINESS PROFILES  (the "define your business & needs" onboarding form)
-- ---------------------------------------------------------------------------
create table if not exists public.business_profiles (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references auth.users(id) on delete cascade,
  niche                text not null,               -- free text -> lib/niche.ts
  target_customer      text,
  location             text not null,               -- geocoded by lib/geocode.ts
  radius_km            integer not null default 15,
  monthly_lead_volume  integer not null,            -- drives the quote
  min_quality_score    integer not null default 0,  -- 0-100 gate (ties to GRADE_SCALE)
  quality_requirements jsonb,                        -- {requireEmail, requirePhone, ...}
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index if not exists business_profiles_user_id_idx on public.business_profiles(user_id);

-- ---------------------------------------------------------------------------
-- 3. QUOTES  (server-computed custom price for a business profile)
-- ---------------------------------------------------------------------------
create table if not exists public.quotes (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users(id) on delete cascade,
  business_profile_id uuid not null references public.business_profiles(id) on delete cascade,
  monthly_lead_volume integer not null,
  unit_price_cents    integer not null,
  amount_cents        integer not null,
  currency            text not null default 'usd',
  breakdown           jsonb not null,               -- transparent line items
  status              text not null default 'draft',-- draft | accepted | expired
  expires_at          timestamptz,
  created_at          timestamptz not null default now()
);
create index if not exists quotes_user_id_idx on public.quotes(user_id);

-- ---------------------------------------------------------------------------
-- 4. ORDERS  (one per Stripe Checkout session; the entitlement record)
-- ---------------------------------------------------------------------------
create table if not exists public.orders (
  id                         uuid primary key default gen_random_uuid(),
  user_id                    uuid not null references auth.users(id) on delete cascade,
  quote_id                   uuid references public.quotes(id) on delete set null,
  stripe_checkout_session_id text unique,
  stripe_payment_intent_id   text,
  stripe_subscription_id     text,
  amount_cents               integer not null,
  currency                   text not null default 'usd',
  status                     text not null default 'pending', -- pending | paid | failed | refunded
  lead_quota                 integer not null default 0,
  leads_used                 integer not null default 0,
  period_start               timestamptz,
  period_end                 timestamptz,
  created_at                 timestamptz not null default now(),
  paid_at                    timestamptz
);
create index if not exists orders_user_id_idx on public.orders(user_id);
create index if not exists orders_status_idx  on public.orders(status);

-- ---------------------------------------------------------------------------
-- 5. SAVED SEARCHES
-- ---------------------------------------------------------------------------
create table if not exists public.saved_searches (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  niche       text not null,
  location    text not null,
  limit_count integer not null default 40,
  filters     jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists saved_searches_user_id_idx on public.saved_searches(user_id);

-- ---------------------------------------------------------------------------
-- 6. SEARCHES  (one discovery run; parent of leads + enrichment jobs)
-- ---------------------------------------------------------------------------
create table if not exists public.searches (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  order_id      uuid references public.orders(id) on delete set null,
  niche         text not null,
  location      text not null,
  resolved_area text,
  matched_tags  jsonb,
  notes         jsonb,
  status        text not null default 'discovering', -- discovering | enriching | complete
  scanned_at    timestamptz not null default now()
);
create index if not exists searches_user_id_idx on public.searches(user_id);

-- ---------------------------------------------------------------------------
-- 7. LEADS  (per-lead rows, enriched/verified progressively)
-- ---------------------------------------------------------------------------
create table if not exists public.leads (
  id                    uuid primary key default gen_random_uuid(),
  search_id             uuid not null references public.searches(id) on delete cascade,
  user_id               uuid not null references auth.users(id) on delete cascade,
  source                text not null default 'osm',
  source_id             text,
  name                  text not null,
  category              text,
  phone                 text,
  phone_normalized      text,
  phone_type            text,
  phone_valid           boolean,
  phone_reachable       boolean,
  website               text,
  email                 text,
  email_verified_status text default 'pending',   -- deliverable|risky|undeliverable|unknown|pending
  email_score           integer,
  email_source          text,
  address               text,
  city                  text,
  lat                   double precision,
  lon                   double precision,
  map_url               text,
  business_status       text,
  active_status         text,
  active_score          integer,
  last_updated          text,
  freshness             text,
  score                 integer not null default 0,
  tier                  text not null default 'COOL',
  verification_status   text not null default 'pending', -- pending | verified | unverifiable
  deliverable           boolean not null default false,
  verified_at           timestamptz,
  raw                   jsonb,
  created_at            timestamptz not null default now()
);
create index if not exists leads_search_id_idx on public.leads(search_id);
create index if not exists leads_user_id_idx   on public.leads(user_id);

-- ---------------------------------------------------------------------------
-- 8. ENRICHMENT JOBS  (queue drained by cron / worker)
-- ---------------------------------------------------------------------------
create table if not exists public.enrichment_jobs (
  id         uuid primary key default gen_random_uuid(),
  search_id  uuid not null references public.searches(id) on delete cascade,
  lead_id    uuid references public.leads(id) on delete cascade,
  kind       text not null default 'full',   -- email | phone | active | full
  status     text not null default 'queued', -- queued | running | done | failed
  attempts   integer not null default 0,
  locked_at  timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists enrichment_jobs_status_idx on public.enrichment_jobs(status);

-- ---------------------------------------------------------------------------
-- 9. EMAIL VERIFICATIONS  (cache keyed by email; never verify the same twice)
-- ---------------------------------------------------------------------------
create table if not exists public.email_verifications (
  email      text primary key,
  status     text not null,                  -- deliverable|risky|undeliverable|unknown
  mx_ok      boolean,
  syntax_ok  boolean,
  disposable boolean,
  smtp_ok    boolean,
  catch_all  boolean,
  provider   text not null default 'internal',
  checked_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Auto-create a profile row whenever a new auth user signs up
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.profiles           enable row level security;
alter table public.business_profiles  enable row level security;
alter table public.quotes             enable row level security;
alter table public.orders             enable row level security;
alter table public.saved_searches     enable row level security;
alter table public.searches           enable row level security;
alter table public.leads              enable row level security;
alter table public.enrichment_jobs    enable row level security;
alter table public.email_verifications enable row level security;

-- profiles: owner keyed by id
drop policy if exists "profiles_select" on public.profiles;
drop policy if exists "profiles_update" on public.profiles;
create policy "profiles_select" on public.profiles for select using (auth.uid() = id);
create policy "profiles_update" on public.profiles for update using (auth.uid() = id);

-- Helper: user-owned tables get full CRUD on their own rows.
-- business_profiles
drop policy if exists "bp_all" on public.business_profiles;
create policy "bp_all" on public.business_profiles
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- saved_searches
drop policy if exists "ss_all" on public.saved_searches;
create policy "ss_all" on public.saved_searches
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- searches (users create their own; enrichment updates come via service role)
drop policy if exists "searches_all" on public.searches;
create policy "searches_all" on public.searches
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- leads: users read their own; writes happen via service role (enrichment)
drop policy if exists "leads_select" on public.leads;
create policy "leads_select" on public.leads for select using (auth.uid() = user_id);

-- quotes & orders: READ-ONLY to users. No insert/update policy => only service role writes.
drop policy if exists "quotes_select" on public.quotes;
create policy "quotes_select" on public.quotes for select using (auth.uid() = user_id);

drop policy if exists "orders_select" on public.orders;
create policy "orders_select" on public.orders for select using (auth.uid() = user_id);

-- enrichment_jobs & email_verifications: service-role only (no user policies).
