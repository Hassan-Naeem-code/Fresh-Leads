-- ---------------------------------------------------------------------------
-- 018. TWO FACTOR AUTHENTICATION
--
-- Required for every account, customer and admin alike. Signing in with a password
-- is no longer enough to reach anything.
--
-- Three tables and one rule behind all of them: the server never stores anything
-- that would let it, or anyone who steals the database, pass a challenge on its own.
-- TOTP secrets are encrypted with a key that lives only in the environment. Emailed
-- and texted codes are stored as hashes, never in the clear. Recovery codes are
-- hashed the same way and are single use.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. FACTORS: the things you can prove yourself with
--
-- user_id is null for the admin credential, which is not a Supabase user. Exactly one
-- of user_id or admin_email is set, enforced below.
-- ---------------------------------------------------------------------------
create table if not exists public.mfa_factors (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid references auth.users(id) on delete cascade,
  admin_email  text,
  -- totp | email | sms | passkey
  kind         text not null,
  -- What the person calls it: "iPhone", "work laptop", "Google Authenticator".
  label        text,
  -- TOTP: the shared secret, encrypted. Passkey: the public key. Null for email.
  secret       text,
  -- SMS only, in E.164. Kept here rather than on the profile because a login factor
  -- and a contact number are different things and should not drift into each other.
  phone        text,
  -- Passkey only: the credential id the browser hands back, and its signature counter.
  credential_id text,
  sign_count   bigint not null default 0,
  -- Null until the first successful challenge. An unconfirmed factor grants nothing,
  -- so a half finished setup can never lock somebody out or let them in.
  confirmed_at timestamptz,
  last_used_at timestamptz,
  created_at   timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'mfa_factors_kind_valid') then
    alter table public.mfa_factors add constraint mfa_factors_kind_valid
      check (kind in ('totp', 'email', 'sms', 'passkey'));
  end if;
  -- One owner, never both and never neither.
  if not exists (select 1 from pg_constraint where conname = 'mfa_factors_one_owner') then
    alter table public.mfa_factors add constraint mfa_factors_one_owner
      check ((user_id is not null) <> (admin_email is not null));
  end if;
end $$;

create index if not exists mfa_factors_user_idx on public.mfa_factors (user_id) where user_id is not null;
create index if not exists mfa_factors_admin_idx on public.mfa_factors (admin_email) where admin_email is not null;
-- A passkey credential id must be globally unique: it is what identifies the key.
create unique index if not exists mfa_factors_credential_idx
  on public.mfa_factors (credential_id) where credential_id is not null;

alter table public.mfa_factors enable row level security;
-- A user may SEE their own factors, which is what the settings screen lists. They may
-- not write here: enrolling and removing both go through the server, because both are
-- security decisions and neither should be reachable from a browser with a token.
drop policy if exists mfa_factors_select_own on public.mfa_factors;
create policy mfa_factors_select_own on public.mfa_factors
  for select using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 2. CHALLENGES: a code we sent, waiting to be answered
--
-- Rows are short lived and are consumed on use. `attempts` is what stops a six digit
-- code being guessed: five tries and the challenge is dead, so an attacker gets five
-- chances in ten minutes rather than a million.
-- ---------------------------------------------------------------------------
create table if not exists public.mfa_challenges (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users(id) on delete cascade,
  admin_email text,
  factor_id   uuid references public.mfa_factors(id) on delete cascade,
  -- sha256 of the code. Never the code itself: a leaked table must not be a way in.
  code_hash   text not null,
  -- Where it went, so the screen can say "we sent it to j...@example.com".
  sent_to     text,
  attempts    integer not null default 0,
  expires_at  timestamptz not null,
  consumed_at timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists mfa_challenges_user_idx on public.mfa_challenges (user_id, created_at desc);
create index if not exists mfa_challenges_expiry_idx on public.mfa_challenges (expires_at);

alter table public.mfa_challenges enable row level security;
-- No policies at all. A challenge is between the browser and the server; nothing about
-- it should be readable by the client, not even its own.

-- ---------------------------------------------------------------------------
-- 3. RECOVERY CODES: the way back in when the phone is gone
--
-- Without these, mandatory two factor means a lost phone is a lost account and a
-- support ticket that can only be resolved by turning the protection off. Ten codes,
-- hashed, each usable once.
-- ---------------------------------------------------------------------------
create table if not exists public.mfa_recovery_codes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users(id) on delete cascade,
  admin_email text,
  code_hash   text not null,
  used_at     timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists mfa_recovery_user_idx on public.mfa_recovery_codes (user_id) where user_id is not null;
create index if not exists mfa_recovery_admin_idx on public.mfa_recovery_codes (admin_email) where admin_email is not null;

alter table public.mfa_recovery_codes enable row level security;
-- No policies: server only, same reasoning as the challenges.

-- ---------------------------------------------------------------------------
-- 4. HOUSEKEEPING
--
-- Expired challenges are rubbish within the hour. Nothing depends on them existing,
-- so anything old enough is safe to remove.
-- ---------------------------------------------------------------------------
create or replace function public.purge_expired_mfa_challenges()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  removed integer;
begin
  delete from public.mfa_challenges
   where expires_at < now() - interval '1 hour';
  get diagnostics removed = row_count;
  return removed;
end;
$$;

revoke all on function public.purge_expired_mfa_challenges() from public, anon, authenticated;
