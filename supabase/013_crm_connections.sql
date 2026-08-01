-- ---------------------------------------------------------------------------
-- 013. CRM CONNECTIONS (OAuth tokens for pushing leads out)
--
-- A CSV export that imports cleanly covers most customers. A connected CRM covers the
-- ones who will not do a manual import at all, and both competitors sell it.
--
-- These rows hold live OAuth credentials. Two things protect them:
--
--   * The tokens are ENCRYPTED before they are written (lib/crm/store.ts, AES-256-GCM).
--     A leaked copy of this table is not a set of working credentials, in the same
--     spirit as api_keys storing only a hash.
--   * Row level security is on with NO policies, so nothing but the service role can
--     read the table at all. The same pattern as admin_accounts.
--
-- One connection per provider per user. Reconnecting replaces the row rather than
-- accumulating stale tokens, which is what the unique index enforces.
-- ---------------------------------------------------------------------------

create table if not exists public.crm_connections (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  -- hubspot today. Salesforce and others slot in behind the same shape.
  provider       text not null,
  -- Encrypted. Never a readable token, even to someone holding this row.
  access_token   text not null,
  refresh_token  text,
  expires_at     timestamptz,
  -- Which account the tokens belong to, shown in the UI so a customer can tell
  -- which of their portals is connected. Not a secret.
  account_label  text,
  connected_at   timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create unique index if not exists crm_connections_user_provider_idx
  on public.crm_connections (user_id, provider);

alter table public.crm_connections enable row level security;
-- No policies on purpose. Only the service role touches this table, and it does so
-- after the server has established who is asking.
