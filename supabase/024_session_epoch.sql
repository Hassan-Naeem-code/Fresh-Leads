-- SIGN OUT EVERYWHERE, for the operator account
--
-- "Trust this device for 30 days" is a promise, and a promise you cannot take back is
-- a liability. A trusted laptop that is lost or stolen carries a second factor pass for
-- a month, and until now the only way to deal with that was to change the password and
-- hope. That is a strange gap in a product where two factor is mandatory.
--
-- Customers do not need a table for this: their epoch lives in the Supabase user's
-- app_metadata, which middleware already fetches on every request, so checking it costs
-- nothing extra. The operator is NOT a Supabase user, deliberately (see the invariants
-- note in lib/admin/accounts.ts), so it needs somewhere of its own.
--
-- The mechanism: every issued token carries the epoch it was minted under. Bumping the
-- number here does not delete anything, it simply makes every token that came before
-- stop matching. Nothing to enumerate, nothing to clean up, and no way for a token to
-- survive by being missed.
alter table public.admin_accounts
  add column if not exists session_epoch integer not null default 0;

-- One statement, so two revocations at once cannot both read 3 and both write 4. It
-- returns the new value because the caller has to mint its own replacement session with
-- it, and reading it back separately would race with another revocation.
create or replace function public.bump_admin_session_epoch(p_email text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  next_epoch integer;
begin
  update public.admin_accounts
     set session_epoch = session_epoch + 1
   where lower(email) = lower(p_email)
  returning session_epoch into next_epoch;

  return coalesce(next_epoch, 0);
end;
$$;

revoke all on function public.bump_admin_session_epoch(text) from public, anon, authenticated;
