-- HANDING A TEAM OVER, AND CLOSING ONE
--
-- The product already told people to do this. Trying to remove the billing owner
-- answered "transfer the team first", and there was no transfer, so a team owner could
-- not leave, hand over, or wind up their team. An error message pointing at a feature
-- that does not exist is worse than a plain refusal.
--
-- WHY THIS IS SQL AND NOT FOUR APP CALLS. The billing owner is not a label, it IS the
-- wallet: profiles.credits holds the team's balance and lead_unlocks(user_id, lead_key)
-- holds everything the team has ever paid to open. Point the team at a new owner without
-- moving those and the shared balance drops to whatever the new owner happens to have,
-- and every lead the team bought becomes locked again. That is the bill twice failure
-- this product exists to avoid, arriving through the back door.
--
-- So the move is one function, which is one transaction. It cannot half happen.

create or replace function public.transfer_org_ownership(
  p_org_id uuid,
  p_from   uuid,
  p_to     uuid
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_credits integer;
  v_new_balance integer;
begin
  -- The caller is trusted (service role, after a role check), but the invariants are
  -- re-checked here because this is the function that moves the money.
  if not exists (select 1 from public.organisations where id = p_org_id and owner_user_id = p_from) then
    return 'not_owner';
  end if;
  if not exists (select 1 from public.org_members where org_id = p_org_id and user_id = p_to) then
    return 'not_a_member';
  end if;
  if p_from = p_to then
    return 'same_person';
  end if;

  -- 1. THE BALANCE. Moved, not copied. The team keeps exactly what it had, and the
  --    outgoing owner keeps nothing of it, because it was never personally theirs.
  select coalesce(credits, 0) into v_credits from public.profiles where id = p_from for update;

  update public.profiles set credits = 0 where id = p_from;
  update public.profiles set credits = coalesce(credits, 0) + v_credits where id = p_to
  returning credits into v_new_balance;

  -- Both sides of the move are recorded. A balance that changes with no ledger entry is
  -- how a customer stops trusting the number.
  if v_credits > 0 then
    insert into public.credit_ledger (user_id, delta, reason, ref, balance_after)
    values (p_from, -v_credits, 'team_transfer', p_org_id::text, 0)
    on conflict do nothing;
    insert into public.credit_ledger (user_id, delta, reason, ref, balance_after)
    values (p_to, v_credits, 'team_transfer', p_org_id::text, v_new_balance)
    on conflict do nothing;
  end if;

  -- 2. EVERYTHING THE TEAM HAS PAID TO OPEN. Without this the team is silently asked to
  --    buy its own history back. ON CONFLICT DO NOTHING because the new owner may
  --    already have opened some of the same businesses themselves, and the unique index
  --    on (user_id, lead_key) is the no-double-charge guarantee: it must not be fought.
  update public.lead_unlocks set user_id = p_to
   where user_id = p_from
     and lead_key not in (select lead_key from public.lead_unlocks where user_id = p_to);
  delete from public.lead_unlocks where user_id = p_from;

  update public.owner_unlocks set user_id = p_to
   where user_id = p_from
     and lead_key not in (select lead_key from public.owner_unlocks where user_id = p_to);
  delete from public.owner_unlocks where user_id = p_from;

  -- 3. THE SUBSCRIPTION IS DELIBERATELY NOT MOVED.
  --
  --    It is a row about a Stripe subscription that Stripe is still billing to the old
  --    owner's card, and rewriting whose it is would leave the renewal webhook updating
  --    a person who is not paying. The team's access therefore follows the new owner,
  --    and the interface says so plainly before anyone presses the button. Moving money
  --    we hold is ours to do; moving somebody's card is not.

  -- 4. The roles. The outgoing owner stays as an admin rather than being dropped: they
  --    were running the team a moment ago and losing all access is nobody's intent.
  update public.organisations set owner_user_id = p_to where id = p_org_id;
  update public.org_members set role = 'owner' where org_id = p_org_id and user_id = p_to;
  update public.org_members set role = 'admin' where org_id = p_org_id and user_id = p_from;

  return 'ok';
end;
$$;

revoke all on function public.transfer_org_ownership(uuid, uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- CLOSING A TEAM
--
-- Nothing is deleted except the team itself. The credits and the unlocked leads stay
-- exactly where they are, on the owner's account, because that is where they have been
-- all along: closing a team is the members going back to their own accounts, not
-- anybody losing what they paid for.
-- ---------------------------------------------------------------------------
create or replace function public.close_org(p_org_id uuid, p_by uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.organisations where id = p_org_id and owner_user_id = p_by) then
    return 'not_owner';
  end if;

  -- Members and invites cascade from the organisations row.
  delete from public.organisations where id = p_org_id;
  return 'ok';
end;
$$;

revoke all on function public.close_org(uuid, uuid) from public, anon, authenticated;
