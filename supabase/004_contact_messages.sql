-- Contact form submissions from the public /contact page.
-- Written by the service-role client only (the public API route), so no RLS
-- policies are granted to anon/authenticated, the table stays invisible to the
-- browser and is read from the admin panel via the service-role client.

create table if not exists public.contact_messages (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  email       text not null,
  company     text,
  message     text not null,
  handled     boolean not null default false,
  created_at  timestamptz not null default now()
);

create index if not exists contact_messages_created_idx
  on public.contact_messages (created_at desc);

alter table public.contact_messages enable row level security;
-- Intentionally NO policies: only the service-role key (which bypasses RLS) may
-- read or write. The anon/authenticated roles get nothing.
