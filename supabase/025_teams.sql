-- TEAM ACCOUNTS
--
-- A five person sales team currently needs five subscriptions, five credit balances,
-- and has no way to see that a colleague already opened the lead they are about to pay
-- for. That is the single biggest reason a team cannot buy this product.
--
-- THE DESIGN, and why it is this rather than a second money system:
--
-- Everything about money here is keyed on a user id. profiles.credits holds the
-- balance, lead_unlocks(user_id, lead_key) carries the no-double-charge guarantee as a
-- unique index, credit_ledger is the audit trail, subscriptions grants access. All of
-- it is proven and all of it is idempotent, which is not a property worth rebuilding.
--
-- So a team does not get a parallel wallet. It gets a BILLING OWNER: one user id that
-- every member's spending resolves to. A member unlocking a lead charges that balance
-- and writes that unlock row, which means a shared pool, shared unlocked leads and one
-- subscription covering the team all fall out of the tables that already exist, with no
-- change to a single money function.
--
-- What it costs: an unlock row no longer says WHO opened it, so acting_user_id is added
-- below for the audit trail. That column is for reading, never for charging.
--
-- One org per person, on purpose. Two would mean every spend needing to know which hat
-- someone is wearing, and a wrong guess spends the wrong team's money.

create table if not exists public.organisations (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  -- The billing owner. Their profile holds the credits and their subscription covers
  -- the team, which is why removing them is refused rather than cascaded: it would
  -- silently orphan the balance everyone else is spending.
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  created_at    timestamptz not null default now()
);

create index if not exists organisations_owner_idx on public.organisations (owner_user_id);

create table if not exists public.org_members (
  org_id     uuid not null references public.organisations(id) on delete cascade,
  -- PRIMARY KEY on user_id, not on the pair. One person is in at most one team, so
  -- "whose money does this spend?" always has exactly one answer.
  user_id    uuid primary key references auth.users(id) on delete cascade,
  -- owner: billing and members. admin: members but not billing. member: search and open.
  role       text not null default 'member' check (role in ('owner', 'admin', 'member')),
  created_at timestamptz not null default now()
);

create index if not exists org_members_org_idx on public.org_members (org_id);

create table if not exists public.org_invites (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organisations(id) on delete cascade,
  email      text not null,
  role       text not null default 'member' check (role in ('admin', 'member')),
  -- The token is stored HASHED, like an API key. An invite link is a credential: it
  -- joins somebody to a team with a shared balance they can spend, so a leaked backup
  -- of this table must not hand out working links.
  token_hash text not null unique,
  invited_by uuid references auth.users(id) on delete set null,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists org_invites_org_idx on public.org_invites (org_id);
create index if not exists org_invites_email_idx on public.org_invites (lower(email));

-- Who actually pressed the button. Attribution only: the charge is always taken from
-- the billing owner, and a team that could not see who spent what would be a team that
-- cannot trust a shared balance.
alter table public.lead_unlocks add column if not exists acting_user_id uuid
  references auth.users(id) on delete set null;
alter table public.credit_ledger add column if not exists acting_user_id uuid
  references auth.users(id) on delete set null;

-- ---------------------------------------------------------------------------
-- WHOSE MONEY
--
-- The single answer, in SQL, so a caller cannot forget to ask. Returns the team's
-- billing owner for a member, and the person themselves for everybody else, which is
-- every account that has never touched teams.
-- ---------------------------------------------------------------------------
create or replace function public.billing_owner(p_user_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select o.owner_user_id
       from public.org_members m
       join public.organisations o on o.id = m.org_id
      where m.user_id = p_user_id),
    p_user_id
  );
$$;

alter table public.organisations enable row level security;
alter table public.org_members enable row level security;
alter table public.org_invites enable row level security;

-- Members may READ their own team and who is in it. Nothing here is writable from a
-- browser: every change goes through a route that checks a role first, and migration
-- 021 is the standing reminder that a policy saying "your own row" says nothing about
-- WHICH COLUMNS. Inviting, removing and role changes all move money rights, so none of
-- them is a place to trust the anon key.
drop policy if exists organisations_read on public.organisations;
create policy organisations_read on public.organisations
  for select to authenticated
  using (id in (select org_id from public.org_members where user_id = auth.uid()));

drop policy if exists org_members_read on public.org_members;
create policy org_members_read on public.org_members
  for select to authenticated
  using (org_id in (select org_id from public.org_members where user_id = auth.uid()));

-- No policy at all on org_invites: a pending invite carries an email address and a
-- role, and the token that goes with it is the credential. Service role only.

revoke insert, update, delete on public.organisations from anon, authenticated;
revoke insert, update, delete on public.org_members from anon, authenticated;
revoke all on public.org_invites from anon, authenticated;
