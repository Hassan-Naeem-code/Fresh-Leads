-- ---------------------------------------------------------------------------
-- 021. URGENT: STOP CUSTOMERS WRITING THEIR OWN BALANCE
--
-- Row level security is exactly that: ROW level. The policy
--
--   create policy "profiles_update" on public.profiles
--     for update using (auth.uid() = id);
--
-- says "you may update your own row" and says nothing at all about WHICH COLUMNS.
-- That was correct when the row held a name and a company. It stopped being correct
-- the moment the row started holding money.
--
-- public.profiles now carries:
--   credits          the spendable balance
--   suspended_at     whether an operator has locked the account
--   admin_note       an internal note the customer is not meant to see
--
-- So any signed-in customer, using only the anon key that ships in every browser
-- bundle, could run this from the console of our own site:
--
--   PATCH /rest/v1/profiles?id=eq.<their own id>   {"credits": 999999}
--
-- and give themselves unlimited leads. The same request with {"suspended_at": null}
-- lifts a suspension we just applied. Both were verified against production before
-- this file was written; both worked.
--
-- THE FIX. Revoke the write privilege itself rather than trying to express column
-- rules in a policy. Nothing in the product needs a browser to write here: every
-- legitimate change to a profile already goes through a server route holding the
-- service role key, which bypasses RLS and is not affected by anything below.
--
-- Defence in depth is deliberate here. The grant is revoked AND the policy is
-- dropped, so restoring either one alone does not reopen the hole.
-- ---------------------------------------------------------------------------

-- 1. The privilege. Without UPDATE granted, no policy can permit an update.
revoke update on public.profiles from anon, authenticated;
revoke insert on public.profiles from anon, authenticated;
revoke delete on public.profiles from anon, authenticated;

-- 2. The policy. Its presence would imply an intent that no longer holds.
drop policy if exists "profiles_update" on public.profiles;

-- 3. Reading stays: the dashboard reads its own profile, and nothing sensitive is
--    exposed by that which the customer cannot already see about themselves.
drop policy if exists "profiles_select" on public.profiles;
create policy "profiles_select" on public.profiles
  for select using (auth.uid() = id);

-- ---------------------------------------------------------------------------
-- 4. A BACKSTOP, in case a future migration re-grants UPDATE by accident.
--
-- Belt and braces on the two columns that are worth money. A trigger cannot be
-- bypassed by a policy mistake, and the service role path does not touch it because
-- the check is on WHO is asking, not on which client library was used.
-- ---------------------------------------------------------------------------
create or replace function public.guard_profile_money_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- current_setting('role') is 'authenticated' or 'anon' for a browser request and
  -- 'service_role' (or the table owner) for trusted server code.
  if current_user in ('authenticated', 'anon') then
    if new.credits is distinct from old.credits then
      raise exception 'credits cannot be changed from a client session';
    end if;
    if new.suspended_at is distinct from old.suspended_at then
      raise exception 'suspension cannot be changed from a client session';
    end if;
    if new.suspended_reason is distinct from old.suspended_reason then
      raise exception 'suspension cannot be changed from a client session';
    end if;
    if new.admin_note is distinct from old.admin_note then
      raise exception 'admin notes cannot be changed from a client session';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_guard_money on public.profiles;
create trigger profiles_guard_money
  before update on public.profiles
  for each row execute function public.guard_profile_money_columns();

-- ---------------------------------------------------------------------------
-- 5. While we are here: the same reasoning applied to the other browser-writable
--    tables, checked one by one.
--
--    business_profiles  their own content, nothing of ours. Left alone.
--    saved_searches     their own content. Left alone.
--    searches           a customer inserting a fake search row achieves nothing:
--                       leads are written by the server, and the history page reads
--                       leads, not the search row's claims. Left alone.
--    credit_ledger      select only already. Correct: this is the audit trail.
--    lead_unlocks       select only already. Correct, or a customer could grant
--                       themselves a lead without paying.
--    email_*            select only already.
-- ---------------------------------------------------------------------------
