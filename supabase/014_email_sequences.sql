-- ---------------------------------------------------------------------------
-- 014. EMAIL SEQUENCES
--
-- Sending on a customer's behalf is different from every other feature here. A bug in
-- lead scoring shows a wrong number. A bug in sending puts mail in a stranger's inbox
-- under the customer's own domain, and the cost is their sending reputation, which
-- takes months to rebuild and cannot be undone by a code fix.
--
-- So the schema is built around three refusals rather than around campaigns:
--
--   1. NEVER send to a suppressed address. email_suppressions is checked before every
--      send, and unsubscribes, bounces and complaints all write to it.
--   2. NEVER send without a way out. Every enrollment carries its own unsubscribe
--      token from the moment it is created, so a message cannot exist without one.
--   3. NEVER send twice. email_messages is unique on (enrollment, step), so a retried
--      or duplicated run cannot mail the same person the same thing again.
--
-- Compliance is not optional decoration. CAN-SPAM requires a working opt out and a
-- real postal address in every commercial message, which is why the from-identity
-- carries an address and is verified before it can be used.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- WHO THE MAIL COMES FROM
--
-- One verified identity per user. Verification is the provider's job (they own the
-- DNS check); we record the outcome so nothing can send from an unverified domain.
-- ---------------------------------------------------------------------------
create table if not exists public.email_identities (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  from_email    text not null,
  from_name     text not null,
  -- Required in every commercial message by CAN-SPAM. Stored here so it cannot be
  -- forgotten at send time.
  postal_address text not null,
  -- Set only when the provider confirms the domain. Nothing sends until it is true.
  verified      boolean not null default false,
  verified_at   timestamptz,
  created_at    timestamptz not null default now()
);

alter table public.email_identities enable row level security;
drop policy if exists email_identities_own on public.email_identities;
create policy email_identities_own on public.email_identities
  for select using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- SUPPRESSION: the list that outranks everything else
--
-- Checked before every single send. An address lands here when someone unsubscribes,
-- when mail to them hard bounces, or when they mark it as spam. Nothing removes a row
-- automatically, and the app offers no way to delete one: a customer who could clear
-- their own suppression list could mail people who asked not to be mailed.
-- ---------------------------------------------------------------------------
create table if not exists public.email_suppressions (
  id         bigserial primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  email      text not null,
  -- unsubscribed | bounced | complained | manual
  reason     text not null,
  created_at timestamptz not null default now()
);

create unique index if not exists email_suppressions_user_email_idx
  on public.email_suppressions (user_id, lower(email));

alter table public.email_suppressions enable row level security;
drop policy if exists email_suppressions_own on public.email_suppressions;
create policy email_suppressions_own on public.email_suppressions
  for select using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- SEQUENCES AND THEIR STEPS
-- ---------------------------------------------------------------------------
create table if not exists public.email_sequences (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  name        text not null,
  -- draft | active | paused
  status      text not null default 'draft',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists email_sequences_user_idx on public.email_sequences (user_id, created_at desc);

alter table public.email_sequences enable row level security;
drop policy if exists email_sequences_own on public.email_sequences;
create policy email_sequences_own on public.email_sequences
  for select using (auth.uid() = user_id);

create table if not exists public.email_steps (
  id           uuid primary key default gen_random_uuid(),
  sequence_id  uuid not null references public.email_sequences(id) on delete cascade,
  -- 1, 2, 3. Unique per sequence so ordering is never ambiguous.
  position     integer not null,
  -- Days to wait after the previous step. Step 1 uses 0 and goes out on enrollment.
  delay_days   integer not null default 0,
  subject      text not null,
  body         text not null,
  created_at   timestamptz not null default now()
);

create unique index if not exists email_steps_seq_position_idx
  on public.email_steps (sequence_id, position);

alter table public.email_steps enable row level security;
drop policy if exists email_steps_own on public.email_steps;
create policy email_steps_own on public.email_steps
  for select using (
    exists (select 1 from public.email_sequences s
            where s.id = email_steps.sequence_id and s.user_id = auth.uid())
  );

-- ---------------------------------------------------------------------------
-- ENROLLMENTS: one lead moving through one sequence
-- ---------------------------------------------------------------------------
create table if not exists public.email_enrollments (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  sequence_id   uuid not null references public.email_sequences(id) on delete cascade,
  -- The business, by the same cross-search identity used everywhere else.
  lead_key      text not null,
  lead_id       uuid references public.leads(id) on delete set null,
  to_email      text not null,
  to_name       text,
  -- active | finished | stopped | bounced | unsubscribed
  status        text not null default 'active',
  -- Which step has been SENT. 0 means nothing has gone out yet.
  last_step     integer not null default 0,
  -- When the next step is due. Null once the sequence is over.
  next_run_at   timestamptz,
  -- Minted at enrollment, so a message can never exist without a way to opt out.
  unsubscribe_token text not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- One enrollment per business per sequence. Enrolling a list twice is a no-op rather
-- than a second copy of the same emails.
create unique index if not exists email_enrollments_unique_idx
  on public.email_enrollments (sequence_id, lead_key);

-- The send loop's only query: what is due right now.
create index if not exists email_enrollments_due_idx
  on public.email_enrollments (next_run_at)
  where status = 'active';

create unique index if not exists email_enrollments_token_idx
  on public.email_enrollments (unsubscribe_token);

alter table public.email_enrollments enable row level security;
drop policy if exists email_enrollments_own on public.email_enrollments;
create policy email_enrollments_own on public.email_enrollments
  for select using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- MESSAGES: what was actually sent
--
-- The unique index is the send-once guarantee. A retried run, an overlapping cron
-- tick or a duplicated job all collide here instead of mailing someone twice.
-- ---------------------------------------------------------------------------
create table if not exists public.email_messages (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  enrollment_id uuid not null references public.email_enrollments(id) on delete cascade,
  step_position integer not null,
  to_email      text not null,
  subject       text not null,
  -- queued | sent | delivered | bounced | complained | failed
  status        text not null default 'queued',
  -- The provider's id, so a webhook can find this row again.
  provider_id   text,
  error         text,
  sent_at       timestamptz,
  created_at    timestamptz not null default now()
);

create unique index if not exists email_messages_once_idx
  on public.email_messages (enrollment_id, step_position);

create index if not exists email_messages_provider_idx
  on public.email_messages (provider_id) where provider_id is not null;

alter table public.email_messages enable row level security;
drop policy if exists email_messages_own on public.email_messages;
create policy email_messages_own on public.email_messages
  for select using (auth.uid() = user_id);
