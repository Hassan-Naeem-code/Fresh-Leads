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
  user_id uuid not null references auth.users(id) on delete cascade
);
create table public.leads (
  id uuid primary key default gen_random_uuid(),
  search_id uuid references public.searches(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  source text, source_id text
);
