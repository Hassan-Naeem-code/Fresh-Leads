-- ---------------------------------------------------------------------------
-- 016. SUPPORT TICKETS, PREFERENCES, AND THE RECORD OF A DELETED ACCOUNT
--
-- Three things a signed-in account needs and did not have:
--
--   * a way to ask for help that is attached to the account, so the reply has
--     context and the customer can find the conversation again. The public contact
--     form is for people who are not signed in and cannot serve this: it has no
--     thread, no status, and nowhere for an answer to land.
--   * preferences that belong to the person rather than to a search.
--   * a deletion that actually deletes, with a small record kept of the fact.
--
-- Everything a user owns already cascades from auth.users, so removing the auth
-- user removes their searches, leads, credits, keys, CRM tokens and sequences with
-- it. What survives on purpose is the row below: no name, no email, just the fact
-- that an account was closed and roughly why. That is what an operator needs to
-- answer "did our churn spike last month" without keeping anything about a person
-- who asked to be forgotten.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. PREFERENCES
--
-- Added to profiles, which already cascades from auth.users and already carries
-- per-user settings. A second table would be a join for no benefit.
-- ---------------------------------------------------------------------------
alter table public.profiles
  -- What we call them in the product and at the top of an email.
  add column if not exists display_name text,
  -- How many leads a search asks for by default.
  add column if not exists default_result_count integer,
  -- Opt outs. Product email (a receipt, a password reset) is always sent: it is
  -- transactional and switching it off would hide things people need to see.
  add column if not exists notify_product_news boolean not null default true,
  add column if not exists notify_weekly_digest boolean not null default true,
  add column if not exists preferences_updated_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_display_name_length') then
    alter table public.profiles
      add constraint profiles_display_name_length
      check (display_name is null or length(display_name) <= 80);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'profiles_result_count_range') then
    alter table public.profiles
      add constraint profiles_result_count_range
      check (default_result_count is null or default_result_count between 5 and 80);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. SUPPORT TICKETS
--
-- A ticket is the thread; messages are what is said in it, by either side. Keeping
-- them apart is what makes a reply possible: one row per message, ordered, with an
-- author, rather than a single text column that gets appended to and loses who said
-- what.
-- ---------------------------------------------------------------------------
create table if not exists public.support_tickets (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  subject      text not null,
  -- open        waiting on us
  -- answered    we replied, waiting on them
  -- closed      done, by either side
  status       text not null default 'open',
  -- billing | leads | technical | account | other. Routes it, and tells us over time
  -- which part of the product generates the most confusion.
  topic        text not null default 'other',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  -- Denormalised so the list can sort by "who has been waiting longest" without
  -- reading every message in every thread.
  last_message_at timestamptz not null default now()
);

create index if not exists support_tickets_user_idx
  on public.support_tickets (user_id, last_message_at desc);
-- Partial: the operator queue is only ever the tickets that are not finished.
create index if not exists support_tickets_open_idx
  on public.support_tickets (last_message_at)
  where status <> 'closed';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'support_tickets_status_valid') then
    alter table public.support_tickets add constraint support_tickets_status_valid
      check (status in ('open', 'answered', 'closed'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'support_tickets_topic_valid') then
    alter table public.support_tickets add constraint support_tickets_topic_valid
      check (topic in ('billing', 'leads', 'technical', 'account', 'other'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'support_tickets_subject_length') then
    alter table public.support_tickets add constraint support_tickets_subject_length
      check (length(subject) between 3 and 140);
  end if;
end $$;

create table if not exists public.support_messages (
  id          uuid primary key default gen_random_uuid(),
  ticket_id   uuid not null references public.support_tickets(id) on delete cascade,
  -- Denormalised from the ticket so a user's RLS policy is a column comparison
  -- rather than a subquery on every read.
  user_id     uuid not null references auth.users(id) on delete cascade,
  -- 'customer' or 'support'. Not a user id: support replies come from whoever is
  -- on the admin panel, and the customer should see one voice, not a name that
  -- changes with the shift.
  author      text not null,
  body        text not null,
  created_at  timestamptz not null default now()
);

create index if not exists support_messages_ticket_idx
  on public.support_messages (ticket_id, created_at);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'support_messages_author_valid') then
    alter table public.support_messages add constraint support_messages_author_valid
      check (author in ('customer', 'support'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'support_messages_body_length') then
    alter table public.support_messages add constraint support_messages_body_length
      check (length(body) between 1 and 8000);
  end if;
end $$;

-- RLS. A customer reads their own threads and nothing else. Writes go through the
-- API with the service role, so the browser cannot forge a message from support or
-- reopen a ticket by writing a status directly.
alter table public.support_tickets enable row level security;
drop policy if exists support_tickets_select_own on public.support_tickets;
create policy support_tickets_select_own on public.support_tickets
  for select using (auth.uid() = user_id);

alter table public.support_messages enable row level security;
drop policy if exists support_messages_select_own on public.support_messages;
create policy support_messages_select_own on public.support_messages
  for select using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 3. WHAT SURVIVES A DELETION
--
-- Deliberately holds nothing that identifies a person. It exists so closures can be
-- counted and read for a reason, and for no other purpose. There is no user_id
-- column on purpose: a foreign key to a row that is being deleted would either
-- cascade this away or block the delete.
-- ---------------------------------------------------------------------------
create table if not exists public.account_closures (
  id             uuid primary key default gen_random_uuid(),
  -- Free text, their words, optional. The form does not require a reason.
  reason         text,
  -- Was this a paying customer when they left? The one fact worth keeping.
  was_subscribed boolean not null default false,
  closed_at      timestamptz not null default now()
);

create index if not exists account_closures_closed_idx
  on public.account_closures (closed_at desc);

alter table public.account_closures enable row level security;
-- No policies: service role only, like contact_messages.

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'account_closures_reason_length') then
    alter table public.account_closures add constraint account_closures_reason_length
      check (reason is null or length(reason) <= 1000);
  end if;
end $$;
