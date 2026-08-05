-- NEWSLETTER SUBSCRIBERS
--
-- A mailing list is a promise to send somebody things, and the two ways it goes wrong
-- are both expensive. Signing people up who never asked destroys the sending domain's
-- reputation, which takes months to rebuild and breaks every transactional email in the
-- product along the way. Making it hard to leave is illegal in most of the places these
-- addresses will come from.
--
-- So: one row per address, an unsubscribe token minted at signup rather than derived
-- from the address, and confirmation recorded separately from creation so a list can be
-- filtered down to people who actually clicked.
create table if not exists public.newsletter_subscribers (
  id             uuid primary key default gen_random_uuid(),
  -- Lowercased by the application. The unique index is what makes signing up twice a
  -- no-op instead of two copies of every email.
  email          text not null unique,
  -- Double opt in. A row with this null has asked but not proven the address is theirs,
  -- and must not be sent anything except the confirmation itself.
  confirmed_at   timestamptz,
  unsubscribed_at timestamptz,
  -- Random, not a hash of the email: a token anybody can compute for any address is a
  -- way to unsubscribe strangers.
  token          text not null unique,
  -- Where they signed up, so a source that produces complaints can be found and turned
  -- off rather than guessed at.
  source         text,
  created_at     timestamptz not null default now()
);

create index if not exists newsletter_confirmed_idx
  on public.newsletter_subscribers (confirmed_at) where unsubscribed_at is null;

alter table public.newsletter_subscribers enable row level security;
-- No policies. Service role only: this table is a list of email addresses, which is
-- exactly the kind of thing that must never be readable with the key that ships in
-- every browser bundle.
revoke all on public.newsletter_subscribers from anon, authenticated;
