-- ---------------------------------------------------------------------------
-- 010. OWNER REVEALS (tiered credit mechanics)
--
-- Every platform in this category prices contact depth in tiers: Openmart charges
-- 3 credits for an owner email and 9 for a direct line, against a fraction of a
-- credit for a business address. The reasoning is sound. Owner detail is the
-- expensive part to obtain and the valuable part to receive, so it should not be
-- bundled into the price of merely seeing a business.
--
-- Here that becomes: opening a lead costs one credit and gives the business contact
-- and the full grading. Revealing WHO RUNS IT costs one more.
--
-- This mirrors lead_unlocks exactly, including the guarantee that matters: a reveal
-- is permanent and charged at most once, enforced by a unique index rather than by
-- application code, so a double click or a retried request cannot bill twice.
--
-- The rule the application adds on top: a reveal is only ever offered, and only ever
-- charged, when we actually hold owner detail for that business. Measured coverage is
-- 38%, so most leads will never present the option at all. Selling a reveal that
-- returns nothing would be indefensible.
-- ---------------------------------------------------------------------------

create table if not exists public.owner_unlocks (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  -- Same cross-search business identity as lead_unlocks, "<source>:<source_id>".
  lead_key    text not null,
  lead_id     uuid references public.leads(id) on delete set null,
  unlocked_at timestamptz not null default now()
);

-- The no-double-charge guarantee.
create unique index if not exists owner_unlocks_user_key_idx
  on public.owner_unlocks(user_id, lead_key);

alter table public.owner_unlocks enable row level security;
drop policy if exists owner_unlocks_select_own on public.owner_unlocks;
create policy owner_unlocks_select_own on public.owner_unlocks
  for select using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- REVEAL THE OWNER (spend exactly one credit, at most once per business)
--
-- Returns one row: (status, credits_left)
--   'unlocked'     -> a credit was spent just now
--   'already'      -> revealed previously, nothing charged
--   'insufficient' -> not enough credits, nothing changed
--
-- Deliberately a copy of unlock_lead rather than a generalisation of it. The two
-- charge different things and will diverge; sharing one function would mean a change
-- to lead unlocking could silently alter what an owner reveal costs.
-- ---------------------------------------------------------------------------
create or replace function public.unlock_owner(
  p_user_id  uuid,
  p_lead_key text,
  p_lead_id  uuid default null
)
returns table (status text, credits_left integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance integer;
  v_ledger_id bigint;
begin
  -- Already paid for? Free forever after.
  if exists (
    select 1 from public.owner_unlocks
    where user_id = p_user_id and lead_key = p_lead_key
  ) then
    select credits into v_balance from public.profiles where id = p_user_id;
    return query select 'already'::text, coalesce(v_balance, 0);
    return;
  end if;

  -- Take the credit only if there is one. The conditional UPDATE is what makes this
  -- safe under concurrent requests: two tabs cannot both see a balance of 1 and both
  -- spend it.
  update public.profiles
     set credits = credits - 1
   where id = p_user_id and credits >= 1
  returning credits into v_balance;

  if v_balance is null then
    select credits into v_balance from public.profiles where id = p_user_id;
    return query select 'insufficient'::text, coalesce(v_balance, 0);
    return;
  end if;

  -- Claim the reveal. If a concurrent request won the race, refund and report
  -- 'already', so the loser is never charged for what the winner bought.
  begin
    insert into public.owner_unlocks (user_id, lead_key, lead_id)
    values (p_user_id, p_lead_key, p_lead_id);
  exception when unique_violation then
    update public.profiles set credits = credits + 1 where id = p_user_id
    returning credits into v_balance;
    return query select 'already'::text, coalesce(v_balance, 0);
    return;
  end;

  insert into public.credit_ledger (user_id, delta, reason, ref, balance_after)
  values (p_user_id, -1, 'owner_reveal', p_lead_key, v_balance)
  returning id into v_ledger_id;

  return query select 'unlocked'::text, v_balance;
end;
$$;
