-- Minimal stand-in for the parts of the Supabase schema migration 006 touches.
create schema if not exists auth;
create table auth.users (id uuid primary key default gen_random_uuid(), email text);
create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
create role anon;
create role authenticated;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text, stripe_customer_id text unique,
  created_at timestamptz not null default now()
);
create table public.searches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- Mirrors the real schema. Migration 033 indexes this, so a stub without it fails to
  -- apply, which is the harness lying about a migration rather than the migration
  -- being wrong.
  niche text,
  location text,
  scanned_at timestamptz not null default now()
);
create table public.leads (
  id uuid primary key default gen_random_uuid(),
  search_id uuid references public.searches(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  source text, source_id text
);

-- ---------------------------------------------------------------------------
-- The rest of what the migrations expect to already exist.
--
-- Added so EVERY migration can be applied here, not just the ones the credit tests
-- need. That is the point of this file: a migration that Postgres rejects should fail
-- in CI, where it is free, rather than in the Supabase SQL editor after a deploy.
-- Three migrations used to fail here purely because these stubs were missing, which
-- made them look broken when they were fine.
-- ---------------------------------------------------------------------------

-- Supabase's storage schema. 002 registers a bucket for the site logo.
create schema if not exists storage;
create table if not exists storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false
);
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name text
);

-- Columns the real leads table has from schema.sql, which 005 indexes.
alter table public.leads
  add column if not exists phone_normalized text,
  add column if not exists deliverable boolean,
  add column if not exists score integer,
  add column if not exists tier text,
  add column if not exists created_at timestamptz not null default now();

-- 009 extends this rather than creating it; it comes from schema.sql.
create table if not exists public.saved_searches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  niche text,
  location text,
  created_at timestamptz not null default now()
);

-- Orders, referenced by 005's index and by the credit tests' fixtures.
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  stripe_subscription_id text,
  created_at timestamptz not null default now()
);
