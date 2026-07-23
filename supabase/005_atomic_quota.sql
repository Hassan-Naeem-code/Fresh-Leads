-- ---------------------------------------------------------------------------
-- 005. ATOMIC QUOTA DEBIT + LEAD DEDUPE SUPPORT
--
-- ⚠️ PARTIALLY SUPERSEDED BY 006. The pricing model moved from "one paid order
-- grants N leads" to credits plus a yearly subscription, so debit_order_leads and
-- renew_order_period are no longer called by the app. They are left in place, and
-- this migration is still worth running, because the leads indexes at the bottom
-- are used by the credit system, and the orders table is kept for the history of
-- anyone who bought under the old model. See 006_credits_and_subscription.sql.
--
-- Two searches running at the same time both used to read orders.leads_used,
-- add their own count, and write the result back. The second write clobbered
-- the first, so a user could be delivered more leads than they paid for. This
-- moves the debit into a single UPDATE that reads and writes in one statement,
-- clamped so leads_used can never pass lead_quota.
--
-- Returns the number of leads ACTUALLY debited, which may be less than asked
-- for if the order ran out mid-flight. Callers should trust the return value
-- over their own count. The `from public.orders prev` alias reads the row as it
-- was before this UPDATE, which is how the delta comes back in one round trip.
-- ---------------------------------------------------------------------------

create or replace function public.debit_order_leads(p_order_id uuid, p_count integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_debited integer;
begin
  if p_count is null or p_count <= 0 then
    return 0;
  end if;

  update public.orders o
     set leads_used = least(o.lead_quota, o.leads_used + p_count)
    from public.orders prev
   where o.id = p_order_id
     and prev.id = o.id
     and o.status = 'paid'
  returning o.leads_used - prev.leads_used
       into v_debited;

  return coalesce(v_debited, 0);
end;
$$;

-- Only the service role calls this; users must never adjust their own quota.
revoke all on function public.debit_order_leads(uuid, integer) from public;
revoke all on function public.debit_order_leads(uuid, integer) from anon;
revoke all on function public.debit_order_leads(uuid, integer) from authenticated;

-- ---------------------------------------------------------------------------
-- RENEWALS
--
-- A monthly subscriber's second invoice used to change nothing: period_end
-- stayed in month one and leads_used was never cleared, so a paying customer
-- silently lost access. Rolling the period forward and zeroing the counter has
-- to be atomic too, otherwise a retried webhook can wipe a fresh month's usage.
-- Guarded on period_end so redelivery of the same invoice is a no-op.
-- ---------------------------------------------------------------------------

create or replace function public.renew_order_period(
  p_subscription_id text,
  p_period_start    timestamptz,
  p_period_end      timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_id uuid;
begin
  update public.orders
     set status       = 'paid',
         leads_used   = 0,
         period_start = p_period_start,
         period_end   = p_period_end,
         paid_at      = now()
   where stripe_subscription_id = p_subscription_id
     -- Only move forward. A duplicate or out-of-order webhook cannot reset a
     -- period that is already current or later.
     and (period_end is null or period_end < p_period_end)
  returning id into v_order_id;

  return v_order_id;
end;
$$;

revoke all on function public.renew_order_period(text, timestamptz, timestamptz) from public;
revoke all on function public.renew_order_period(text, timestamptz, timestamptz) from anon;
revoke all on function public.renew_order_period(text, timestamptz, timestamptz) from authenticated;

-- ---------------------------------------------------------------------------
-- Dedupe support: "have I already delivered this business to this user?" is a
-- hot lookup on every search, so index the identity we dedupe on.
-- ---------------------------------------------------------------------------
create index if not exists leads_user_source_idx
  on public.leads(user_id, source, source_id);

-- Same business, same buyer: normalized phone is the strongest cross-source key.
create index if not exists leads_user_phone_idx
  on public.leads(user_id, phone_normalized)
  where phone_normalized is not null;

-- Subscription lookups on renewal.
create index if not exists orders_subscription_idx
  on public.orders(stripe_subscription_id)
  where stripe_subscription_id is not null;
