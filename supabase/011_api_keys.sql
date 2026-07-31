-- ---------------------------------------------------------------------------
-- 011. API KEYS (programmatic access)
--
-- Both competitors sell an API, and for a certain kind of customer it is the whole
-- purchase: they do not want to log in and click, they want leads arriving in their
-- own system. Without one, Fresh Leads is only comparable to them for people who use
-- a browser.
--
-- The key itself is NEVER stored. Only a SHA-256 hash of it is kept, exactly as a
-- password would be, so a copy of this table is not a set of working credentials.
-- The customer sees the key once, at creation, and never again.
--
-- A short prefix IS stored in clear, because it is how a person identifies which of
-- their keys is which in a list, and it identifies nothing on its own.
-- ---------------------------------------------------------------------------

create table if not exists public.api_keys (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  -- What the customer called it, e.g. "production", "zapier".
  label       text not null default 'API key',
  -- First 10 characters, shown in the UI so keys can be told apart.
  prefix      text not null,
  -- SHA-256 of the full key. The only copy we hold.
  key_hash    text not null unique,
  created_at  timestamptz not null default now(),
  last_used_at timestamptz,
  -- Set instead of deleting, so a revoked key stays auditable.
  revoked_at  timestamptz
);

create index if not exists api_keys_user_idx on public.api_keys(user_id, created_at desc);
create index if not exists api_keys_hash_idx on public.api_keys(key_hash) where revoked_at is null;

alter table public.api_keys enable row level security;

-- Readable by its owner. Never writable from the browser: creating a key mints a
-- credential, and revoking one is a security action, so both go through the service
-- role after the server has checked who is asking.
drop policy if exists api_keys_select_own on public.api_keys;
create policy api_keys_select_own on public.api_keys
  for select using (auth.uid() = user_id);
