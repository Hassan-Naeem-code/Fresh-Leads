-- ---------------------------------------------------------------------------
-- 012. SPEND CREDITS (a general charge, for work that is not a lead unlock)
--
-- Every other charge in the product is tied to a specific business: unlock_lead and
-- unlock_owner both key on a lead_key and are idempotent through it. Bulk enrichment
-- has no such key. It charges for a batch of rows the customer supplied, so it needs a
-- way to take N credits atomically and exactly once.
--
-- Written because the first attempt reused grant_credits with a negative amount, and
-- grant_credits ignores anything at or below zero. The endpoint therefore enriched
-- lists completely free. A billing path that silently does not bill is worse than no
-- billing path at all, which is why this exists rather than a workaround in TypeScript.
--
-- The two guarantees, both enforced here rather than in application code:
--   * the balance can never go negative, via a conditional UPDATE
--   * a retried request cannot charge twice, via the unique index on
--     credit_ledger (user_id, reason, ref)
-- ---------------------------------------------------------------------------

create or replace function public.spend_credits(
  p_user_id uuid,
  p_amount  integer,
  p_reason  text,
  p_ref     text
)
returns table (status text, credits_left integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance integer;
begin
  -- Nothing to charge is a success, not an error: a run that enriched no rows owes
  -- nothing and must not be reported as a failure.
  if p_amount is null or p_amount <= 0 then
    select credits into v_balance from public.profiles where id = p_user_id;
    return query select 'ok'::text, coalesce(v_balance, 0);
    return;
  end if;

  -- Already charged for this exact piece of work?
  if p_ref is not null and exists (
    select 1 from public.credit_ledger
    where user_id = p_user_id and reason = p_reason and ref = p_ref
  ) then
    select credits into v_balance from public.profiles where id = p_user_id;
    return query select 'already'::text, coalesce(v_balance, 0);
    return;
  end if;

  -- Take the credits only if they are all there. The condition inside the UPDATE is
  -- what makes this safe when two requests arrive together: they cannot both see the
  -- same balance and both spend it.
  update public.profiles
     set credits = credits - p_amount
   where id = p_user_id and credits >= p_amount
  returning credits into v_balance;

  if v_balance is null then
    select credits into v_balance from public.profiles where id = p_user_id;
    return query select 'insufficient'::text, coalesce(v_balance, 0);
    return;
  end if;

  -- Record it. If a concurrent request won the race for this ref, put the credits
  -- back rather than charging the loser for what the winner already paid.
  begin
    insert into public.credit_ledger (user_id, delta, reason, ref, balance_after)
    values (p_user_id, -p_amount, p_reason, p_ref, v_balance);
  exception when unique_violation then
    update public.profiles set credits = credits + p_amount where id = p_user_id
    returning credits into v_balance;
    return query select 'already'::text, coalesce(v_balance, 0);
    return;
  end;

  return query select 'ok'::text, v_balance;
end;
$$;
