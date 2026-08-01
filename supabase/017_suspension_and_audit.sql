-- ---------------------------------------------------------------------------
-- 017. SUSPENSION, AND A RECORD OF WHAT THE ADMIN DID
--
-- Two halves of the same thing. The admin can now reach into any account: change a
-- balance, stop someone using the product, sign them out, close them down. Powers
-- like that need a log, and the log needs to be one an operator cannot quietly edit
-- from the panel itself.
--
-- Suspension is deliberately NOT a delete. A suspended account keeps everything it
-- paid for and can be turned back on in one click, because the usual reason to
-- suspend is a suspicion, and suspicions are sometimes wrong.
-- ---------------------------------------------------------------------------

alter table public.profiles
  -- Null means active. A timestamp means locked out from that moment.
  add column if not exists suspended_at timestamptz,
  -- Shown to the customer. Written in the knowledge that they will read it.
  add column if not exists suspended_reason text,
  -- Internal note, never shown to the customer.
  add column if not exists admin_note text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_suspended_reason_length') then
    alter table public.profiles add constraint profiles_suspended_reason_length
      check (suspended_reason is null or length(suspended_reason) <= 500);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'profiles_admin_note_length') then
    alter table public.profiles add constraint profiles_admin_note_length
      check (admin_note is null or length(admin_note) <= 2000);
  end if;
end $$;

create index if not exists profiles_suspended_idx
  on public.profiles (suspended_at) where suspended_at is not null;

-- ---------------------------------------------------------------------------
-- THE ADMIN AUDIT LOG
--
-- Every action an operator takes on somebody else's account. Append only in
-- practice: nothing in the product updates or deletes a row here, and the panel
-- offers no way to.
--
-- target_user_id does NOT cascade. Deleting an account must not erase the record
-- that it was deleted, which is exactly the entry an operator would most want gone.
-- The column is left dangling on purpose and target_email carries what it meant.
-- ---------------------------------------------------------------------------
create table if not exists public.admin_audit_log (
  id             uuid primary key default gen_random_uuid(),
  -- Who did it. The admin's email rather than an id: there is one admin credential
  -- and this stays readable if that ever changes.
  actor          text not null,
  -- grant_credits | revoke_credits | suspend | unsuspend | force_signout |
  -- reset_password | delete_account | comp_access | revoke_access | note
  action         text not null,
  target_user_id uuid,
  -- Kept separately so the entry still says who it was after the account is gone.
  target_email   text,
  -- Free-form context: the amount, the reason, whatever the action needs.
  detail         jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now()
);

create index if not exists admin_audit_created_idx on public.admin_audit_log (created_at desc);
create index if not exists admin_audit_target_idx on public.admin_audit_log (target_user_id, created_at desc);

alter table public.admin_audit_log enable row level security;
-- No policies. Service role only, like the other operator tables: a customer must not
-- be able to read what was done to their account, and must certainly not write here.
