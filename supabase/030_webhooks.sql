-- OUTBOUND WEBHOOKS
--
-- One destination covers Zapier, Make, n8n and anybody's own endpoint, because all of
-- them accept an HTTP POST with JSON. Building a Zapier app instead would mean their
-- review process, their platform, and a thing that only works for their customers.
--
-- A shared secret is minted per endpoint so the receiver can verify the delivery really
-- came from us. Without it, anybody who learns a customer's Zapier catch-hook URL can
-- push fabricated leads into their CRM, and those URLs are not secret: they travel
-- through browsers, chat messages and screenshots.
create table if not exists public.webhook_endpoints (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  url         text not null,
  -- Used to sign the body. Random per endpoint and shown to the customer once so they
  -- can paste it into whatever is receiving.
  secret      text not null,
  active      boolean not null default true,
  -- Enough to answer "did it work?" without keeping a delivery log nobody reads.
  last_sent_at    timestamptz,
  last_status     integer,
  last_error      text,
  created_at  timestamptz not null default now()
);

alter table public.webhook_endpoints enable row level security;
-- No policies: service role only. The row holds a signing secret and a URL that may
-- itself be a capability, so it must not be readable with the key in every browser.
revoke all on public.webhook_endpoints from anon, authenticated;
