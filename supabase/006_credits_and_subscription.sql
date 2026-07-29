-- ---------------------------------------------------------------------------
-- 006. CREDITS + YEARLY SUBSCRIPTION
--
-- Replaces the quota-per-order model with pay-as-you-go:
--   * $30/year subscription  -> the right to use the platform at all
--   * $1 = 1 credit          -> spent to unlock a lead, or to export a locked one
--   * 3 free credits on signup, so a new account can try it without paying
--
-- An unlock is PERMANENT: once a user has spent a credit on a business, viewing
-- and exporting it are free forever. That rule is enforced here, in the database,
-- not in the app, so a double-click, a retried request, or two browser tabs can
-- never charge twice for the same lead.
--
-- Balances live on profiles.credits for cheap reads, and every movement is also
-- written to credit_ledger, so a balance can always be reconciled against its
-- history. Both are written in the same statement by the functions below.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. BALANCE
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists credits integer not null default 0;

-- A balance must never go negative, whatever the app does.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_credits_non_negative'
  ) then
    alter table public.profiles
      add constraint profiles_credits_non_negative check (credits >= 0);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. LEDGER  (append-only audit trail of every credit movement)
-- ---------------------------------------------------------------------------
create table if not exists public.credit_ledger (
  id         bigserial primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  -- Positive = granted (signup bonus, purchase, admin gift).
  -- Negative = spent (lead unlock, export).
  delta      integer not null,
  reason     text not null,        -- signup_bonus | purchase | unlock | export | admin_grant | admin_revoke
  -- Idempotency key. For purchases this is the Stripe checkout session id, for an
  -- unlock the lead key. A unique index on it is what makes a redelivered webhook
  -- or a double-clicked unlock a no-op instead of a second charge.
  ref        text,
  balance_after integer not null,
  created_at timestamptz not null default now()
);
create index if not exists credit_ledger_user_idx on public.credit_ledger(user_id, created_at desc);
create unique index if not exists credit_ledger_ref_idx
  on public.credit_ledger(user_id, reason, ref) where ref is not null;

alter table public.credit_ledger enable row level security;
-- Users may read their own history; only the service role writes it.
drop policy if exists credit_ledger_select_own on public.credit_ledger;
create policy credit_ledger_select_own on public.credit_ledger
  for select using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 3. UNLOCKS  (which businesses this user has already paid to see)
-- ---------------------------------------------------------------------------
create table if not exists public.lead_unlocks (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  -- Stable cross-search identity of the business, "<source>:<source_id>".
  -- NOT the leads.id row id: the same business found again in a later search is a
  -- new row, and the user must not be charged for it twice.
  lead_key    text not null,
  lead_id     uuid references public.leads(id) on delete set null,
  search_id   uuid references public.searches(id) on delete set null,
  unlocked_at timestamptz not null default now()
);
-- The core no-double-charge guarantee.
create unique index if not exists lead_unlocks_user_key_idx
  on public.lead_unlocks(user_id, lead_key);

alter table public.lead_unlocks enable row level security;
drop policy if exists lead_unlocks_select_own on public.lead_unlocks;
create policy lead_unlocks_select_own on public.lead_unlocks
  for select using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 4. SUBSCRIPTION  ($30/year access)
-- ---------------------------------------------------------------------------
create table if not exists public.subscriptions (
  user_id                uuid primary key references auth.users(id) on delete cascade,
  stripe_subscription_id text unique,
  stripe_customer_id     text,
  -- active | canceled | past_due | incomplete
  status                 text not null default 'incomplete',
  current_period_end     timestamptz,
  cancel_at_period_end   boolean not null default false,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create index if not exists subscriptions_stripe_idx
  on public.subscriptions(stripe_subscription_id) where stripe_subscription_id is not null;

alter table public.subscriptions enable row level security;
drop policy if exists subscriptions_select_own on public.subscriptions;
create policy subscriptions_select_own on public.subscriptions
  for select using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 5. GRANT CREDITS
--
-- Used by the signup bonus, Stripe credit purchases, and admin gifts. Idempotent
-- on (user_id, reason, ref): a redelivered Stripe webhook inserts nothing and
-- leaves the balance untouched. Returns the resulting balance, or the CURRENT
-- balance if this grant was a duplicate.
-- ---------------------------------------------------------------------------
create or replace function public.grant_credits(
  p_user_id uuid,
  p_amount  integer,
  p_reason  text,
  p_ref     text default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance   integer;
  v_ledger_id bigint;
begin
  if p_amount is null or p_amount <= 0 then
    select credits into v_balance from public.profiles where id = p_user_id;
    return coalesce(v_balance, 0);
  end if;

  -- Claim the idempotency key first. If this grant was already applied, the
  -- insert conflicts and we return the existing balance without moving it.
  begin
    insert into public.credit_ledger (user_id, delta, reason, ref, balance_after)
    values (p_user_id, p_amount, p_reason, p_ref, 0)
    returning id into v_ledger_id;
  exception when unique_violation then
    select credits into v_balance from public.profiles where id = p_user_id;
    return coalesce(v_balance, 0);
  end;

  update public.profiles
     set credits = credits + p_amount
   where id = p_user_id
  returning credits into v_balance;

  -- Stamp the resulting balance on the row we just inserted, by its own id: a
  -- concurrent grant for the same user would otherwise win a max(id) lookup and
  -- both rows would record the wrong balance.
  update public.credit_ledger
     set balance_after = coalesce(v_balance, p_amount)
   where id = v_ledger_id;

  return coalesce(v_balance, 0);
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. UNLOCK A LEAD  (spend exactly one credit, at most once per business)
--
-- Returns one row: (status, credits_left)
--   'unlocked'      -> a credit was spent just now
--   'already'       -> previously unlocked, nothing charged
--   'insufficient'  -> not enough credits, nothing changed
--
-- The unique index on (user_id, lead_key) is the actual guard: two concurrent
-- requests both see no unlock, both try to insert, and exactly one wins. The
-- loser takes the 'already' path instead of spending a second credit.
-- ---------------------------------------------------------------------------
create or replace function public.unlock_lead(
  p_user_id   uuid,
  p_lead_key  text,
  p_lead_id   uuid default null,
  p_search_id uuid default null
)
returns table (status text, credits_left integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance integer;
begin
  if exists (
    select 1 from public.lead_unlocks
     where user_id = p_user_id and lead_key = p_lead_key
  ) then
    select credits into v_balance from public.profiles where id = p_user_id;
    return query select 'already'::text, coalesce(v_balance, 0);
    return;
  end if;

  -- Take the credit first, conditionally. If the balance is short, nothing moves.
  update public.profiles
     set credits = credits - 1
   where id = p_user_id
     and credits >= 1
  returning credits into v_balance;

  if v_balance is null then
    select credits into v_balance from public.profiles where id = p_user_id;
    return query select 'insufficient'::text, coalesce(v_balance, 0);
    return;
  end if;

  begin
    insert into public.lead_unlocks (user_id, lead_key, lead_id, search_id)
    values (p_user_id, p_lead_key, p_lead_id, p_search_id);
  exception when unique_violation then
    -- A concurrent request unlocked it between our check and our insert. Give the
    -- credit back so the business is still only ever paid for once.
    update public.profiles set credits = credits + 1
     where id = p_user_id
    returning credits into v_balance;
    return query select 'already'::text, coalesce(v_balance, 0);
    return;
  end;

  -- The unlock row above is the record that matters; the ledger entry is the audit
  -- trail. Tolerate a conflict (possible only if an unlock row was deleted by hand
  -- and re-earned) rather than failing a charge that has already been taken.
  insert into public.credit_ledger (user_id, delta, reason, ref, balance_after)
  values (p_user_id, -1, 'unlock', p_lead_key, v_balance)
  on conflict do nothing;

  return query select 'unlocked'::text, v_balance;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. UNLOCK MANY  (export: charge only for the leads still locked)
--
-- All-or-nothing. If the user cannot afford every locked lead in the batch, the
-- export is refused outright rather than exporting a partial set, so the UI can
-- say exactly how many more credits are needed.
--
-- Returns (status, charged, credits_left) where status is 'ok' or 'insufficient'.
-- ---------------------------------------------------------------------------
create or replace function public.unlock_leads_bulk(
  p_user_id   uuid,
  p_lead_keys text[]
)
returns table (status text, charged integer, credits_left integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_needed  integer;
  v_balance integer;
  v_key     text;
  v_keys    text[];
begin
  -- The distinct keys in this batch that are NOT already unlocked, i.e. exactly
  -- what the user has to pay for.
  select array_agg(distinct k)
    into v_keys
    from unnest(coalesce(p_lead_keys, '{}'::text[])) as k
   where k is not null
     and k <> ''
     and not exists (
       select 1 from public.lead_unlocks u
        where u.user_id = p_user_id and u.lead_key = k
     );

  v_needed := coalesce(array_length(v_keys, 1), 0);

  if v_needed = 0 then
    select credits into v_balance from public.profiles where id = p_user_id;
    return query select 'ok'::text, 0, coalesce(v_balance, 0);
    return;
  end if;

  update public.profiles
     set credits = credits - v_needed
   where id = p_user_id
     and credits >= v_needed
  returning credits into v_balance;

  if v_balance is null then
    select credits into v_balance from public.profiles where id = p_user_id;
    return query select 'insufficient'::text, v_needed, coalesce(v_balance, 0);
    return;
  end if;

  foreach v_key in array v_keys loop
    -- ON CONFLICT keeps a concurrent single unlock from breaking the batch.
    insert into public.lead_unlocks (user_id, lead_key)
    values (p_user_id, v_key)
    on conflict (user_id, lead_key) do nothing;
  end loop;

  insert into public.credit_ledger (user_id, delta, reason, ref, balance_after)
  values (p_user_id, -v_needed, 'export', null, v_balance);

  return query select 'ok'::text, v_needed, v_balance;
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. SUBSCRIPTION UPSERT  (called from the Stripe webhook)
-- ---------------------------------------------------------------------------
create or replace function public.upsert_subscription(
  p_user_id         uuid,
  p_subscription_id text,
  p_customer_id     text,
  p_status          text,
  p_period_end      timestamptz,
  p_cancel_at_end   boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.subscriptions as s (
    user_id, stripe_subscription_id, stripe_customer_id, status,
    current_period_end, cancel_at_period_end, updated_at
  )
  values (
    p_user_id, p_subscription_id, p_customer_id, p_status,
    p_period_end, coalesce(p_cancel_at_end, false), now()
  )
  on conflict (user_id) do update
     set stripe_subscription_id = coalesce(excluded.stripe_subscription_id, s.stripe_subscription_id),
         stripe_customer_id     = coalesce(excluded.stripe_customer_id, s.stripe_customer_id),
         status                 = excluded.status,
         -- Only ever move the period forward, so an out-of-order webhook cannot
         -- shorten access the customer has already paid for.
         current_period_end     = greatest(
                                    coalesce(excluded.current_period_end, s.current_period_end),
                                    coalesce(s.current_period_end, excluded.current_period_end)
                                  ),
         cancel_at_period_end   = excluded.cancel_at_period_end,
         updated_at             = now();
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. PERMISSIONS
-- Every function above moves money-equivalent state, so only the service role may
-- call them. The app always goes through server routes that authenticate first.
-- ---------------------------------------------------------------------------
do $$
declare fn text;
begin
  foreach fn in array array[
    'public.grant_credits(uuid, integer, text, text)',
    'public.unlock_lead(uuid, text, uuid, uuid)',
    'public.unlock_leads_bulk(uuid, text[])',
    'public.upsert_subscription(uuid, text, text, text, timestamptz, boolean)'
  ] loop
    execute format('revoke all on function %s from public', fn);
    execute format('revoke all on function %s from anon', fn);
    execute format('revoke all on function %s from authenticated', fn);
  end loop;
end $$;
