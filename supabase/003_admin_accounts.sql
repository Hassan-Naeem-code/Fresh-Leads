-- Fresh Leads — migration 003: dedicated admin credential (separate from user auth).
-- Run once in the Supabase SQL editor. Safe to re-run.
--
-- The admin is NOT a Supabase auth user. It's a single fixed credential kept here.
-- The row is created automatically on the admin's first login (bootstrapped from
-- the ADMIN_EMAIL / ADMIN_PASSWORD env vars), and the password can then be changed
-- from /admin/account — which updates this row. There is no way to create a second
-- admin from the app.

create table if not exists public.admin_accounts (
  id            integer primary key default 1 check (id = 1), -- singleton: only one admin
  email         text not null,
  password_hash text not null,                                -- scrypt, never plaintext
  updated_at    timestamptz not null default now()
);

alter table public.admin_accounts enable row level security;
-- No policies at all => neither anon nor logged-in users can read the hash.
-- Only the service-role key (server-side admin code) can touch this table.
