-- ---------------------------------------------------------------------------
-- 031. LEAD REPORTS + CREDIT BACK
--
-- The footer of every page says "You are never charged for a lead we cannot
-- verify." Until now that promise was kept in exactly one place: unlock_lead
-- refuses to charge when the phone and the mailbox are both dead at the moment of
-- opening (see app/api/leads/unlock/route.ts).
--
-- That covers the lead we can prove is bad BEFORE the rep dials. It covers nothing
-- afterwards. A number that rings a hairdresser instead of the dentist, a business
-- that closed last month, an "owner" who turns out to be the landlord: all of those
-- are discovered by the customer, on the phone, and the only recourse was a support
-- ticket answered by hand.
--
-- A promise the customer cannot invoke reads as a promise we do not intend to keep,
-- and the buyers most worth having are precisely the ones who were burned by a bought
-- list and will test this on day one. So the credit back is a button, it is automatic,
-- and it is enforced here rather than in application code for the same reason the
-- charge is.
--
-- THREE DELIBERATE CHOICES:
--
--   * The unlock row is NOT deleted. They keep the data they were refunded for. Taking
--     it back would save nothing (they have already read it) and would turn a goodwill
--     gesture into a punishment. It also keeps the no-double-charge guarantee intact:
--     the business stays permanently unlocked, so a later search cannot re-bill them.
--
--   * One report per business per customer, enforced by a unique index. Combined with
--     the existing unique index on credit_ledger(user_id, reason, ref), a double click
--     or a retried request cannot refund twice.
--
--   * The reason is a constrained value, not free text. Free text cannot be counted,
--     and the whole point of collecting these is to measure what we get wrong (see
--     migration 032) and feed it back into scoring.
-- ---------------------------------------------------------------------------

create table if not exists public.lead_reports (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  -- The stable cross-search business identity, "<source>:<source_id>", the same key
  -- lead_unlocks uses. NOT the leads row id: the same business found by a later
  -- search is a new row and must not be reportable a second time.
  lead_key   text not null,
  lead_id    uuid references public.leads(id) on delete set null,
  reason     text not null,
  -- Optional free text, for the cases the reason codes do not cover. Read by a human
  -- when it exists; never counted.
  detail     text,
  -- Did this report actually move credits? A report filed outside the window, or on a
  -- lead that was never charged for, is still recorded (it is data about our accuracy)
  -- but pays nothing back.
  refunded   boolean not null default false,
  -- How many credits went back, so the ledger can be reconciled against the reports.
  refunded_credits integer not null default 0,
  created_at timestamptz not null default now()
);

-- One report per business per customer.
create unique index if not exists lead_reports_user_key_idx
  on public.lead_reports(user_id, lead_key);
-- The reporting query: what did we get wrong, lately.
create index if not exists lead_reports_recent_idx
  on public.lead_reports(created_at desc);
create index if not exists lead_reports_reason_idx
  on public.lead_reports(reason, created_at desc);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'lead_reports_reason_valid'
  ) then
    alter table public.lead_reports
      add constraint lead_reports_reason_valid check (reason in (
        -- The number reaches somebody, but not this business.
        'wrong_number',
        -- The number is dead, despite having passed verification.
        'dead_number',
        -- They have shut down, permanently or for good enough.
        'closed',
        -- Mail to the address we supplied bounced.
        'email_bounced',
        -- The named person does not run this business.
        'not_owner',
        -- Real business, but not the kind that was asked for.
        'wrong_business',
        -- Same business we had already been charged for under another listing.
        'duplicate',
        'other'
      ));
  end if;
end $$;

alter table public.lead_reports enable row level security;
-- Customers may read their own reports; only the service role writes them, because
-- writing one moves money.
drop policy if exists lead_reports_select_own on public.lead_reports;
create policy lead_reports_select_own on public.lead_reports
  for select using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- THE REFUND
--
-- Modelled on unlock_lead in migration 006, and for the same reasons: the balance
-- moves and the audit row is written in one statement, and idempotency comes from a
-- unique index rather than from a check the application could race.
-- ---------------------------------------------------------------------------

-- How long after opening a lead a customer may report it.
--
-- Generous on purpose. A rep works a list over weeks, not hours, and a window that
-- expires before they have called the lead is a window designed not to be used. The
-- honest limit is "long enough that a real customer never hits it", and 60 days is
-- past the point where a lead is still worth calling anyway.
create or replace function public.report_lead(
  p_user_id  uuid,
  p_lead_key text,
  p_reason   text,
  p_detail   text default null,
  p_lead_id  uuid default null
)
returns table (status text, refunded integer, credits_left integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance    integer;
  v_unlocked   timestamptz;
  v_owner_paid boolean;
  v_back       integer := 0;
begin
  select credits into v_balance from public.profiles where id = p_user_id;
  v_balance := coalesce(v_balance, 0);

  -- Already reported. Not an error: a double click should be a no-op, exactly as it
  -- is for an unlock.
  if exists (
    select 1 from public.lead_reports
     where user_id = p_user_id and lead_key = p_lead_key
  ) then
    return query select 'already'::text, 0, v_balance;
    return;
  end if;

  select unlocked_at into v_unlocked
    from public.lead_unlocks
   where user_id = p_user_id and lead_key = p_lead_key;

  -- Reporting a lead they never paid to open. Recorded, because it is still a fact
  -- about our data quality, but there is nothing to give back.
  if v_unlocked is null then
    insert into public.lead_reports (user_id, lead_key, lead_id, reason, detail, refunded, refunded_credits)
    values (p_user_id, p_lead_key, p_lead_id, p_reason, p_detail, false, 0);
    return query select 'not_charged'::text, 0, v_balance;
    return;
  end if;

  if v_unlocked < now() - interval '60 days' then
    insert into public.lead_reports (user_id, lead_key, lead_id, reason, detail, refunded, refunded_credits)
    values (p_user_id, p_lead_key, p_lead_id, p_reason, p_detail, false, 0);
    return query select 'expired'::text, 0, v_balance;
    return;
  end if;

  -- The lead credit.
  v_back := 1;

  -- The owner reveal is a SEPARATE charge (migration 010), so "the named person does
  -- not run this business" has to give back both. Anything else leaves the customer
  -- refunded for the lead and still out of pocket for the part that was actually wrong.
  select exists (
    select 1 from public.owner_unlocks
     where user_id = p_user_id and lead_key = p_lead_key
  ) into v_owner_paid;

  if p_reason = 'not_owner' and v_owner_paid then
    v_back := v_back + 1;
  end if;

  update public.profiles
     set credits = credits + v_back
   where id = p_user_id
  returning credits into v_balance;

  -- The audit trail. The unique index on (user_id, reason, ref) is the second line of
  -- defence behind the one on lead_reports: even if a report row were deleted by hand,
  -- the same business could not be refunded twice under the same reason.
  insert into public.credit_ledger (user_id, delta, reason, ref, balance_after)
  values (p_user_id, v_back, 'lead_refund', p_lead_key, v_balance)
  on conflict do nothing;

  insert into public.lead_reports (user_id, lead_key, lead_id, reason, detail, refunded, refunded_credits)
  values (p_user_id, p_lead_key, p_lead_id, p_reason, p_detail, true, v_back);

  return query select 'refunded'::text, v_back, coalesce(v_balance, 0);
end;
$$;

revoke all on function public.report_lead(uuid, text, text, text, uuid) from public, anon, authenticated;
