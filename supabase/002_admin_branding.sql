-- Fresh Leads — migration 002: site-wide branding settings + logo storage.
-- Run once in the Supabase SQL editor, after schema.sql. Safe to re-run.
--
-- Admin identity is NOT stored here — admins are an env allowlist (ADMIN_EMAILS),
-- checked server-side. This migration only adds the branding surface.

-- ---------------------------------------------------------------------------
-- site_settings — a single-row table (id is pinned to 1) holding the live theme.
-- Public SELECT (theme/brand are public anyway). Writes go through the service
-- role only (admin API), mirroring the quotes/orders policy shape in schema.sql.
-- ---------------------------------------------------------------------------
create table if not exists public.site_settings (
  id          integer primary key default 1 check (id = 1),
  brand_name  text not null default 'Fresh Leads',
  tagline     text not null default 'Verified local business leads, on demand.',
  logo_url    text,
  -- palette — 1:1 with the CSS custom properties in app/globals.css
  bg          text not null default '#0a0e17',
  panel       text not null default '#121826',
  panel2      text not null default '#1a2233',
  border      text not null default '#26304a',
  text        text not null default '#e7ecf5',
  muted       text not null default '#8a97b1',
  accent      text not null default '#4f8cff',
  accent2     text not null default '#23b673',
  hot         text not null default '#ff5470',
  warm        text not null default '#ffb23e',
  cool        text not null default '#46c1a0',
  updated_at  timestamptz not null default now()
);

-- Seed the singleton row with defaults (no-op if it already exists).
insert into public.site_settings (id) values (1) on conflict (id) do nothing;

alter table public.site_settings enable row level security;

drop policy if exists "site_settings_public_read" on public.site_settings;
create policy "site_settings_public_read" on public.site_settings for select using (true);
-- No insert/update/delete policy => only the service-role key can write.

-- ---------------------------------------------------------------------------
-- Storage bucket for uploaded logos (public read; writes via service role).
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('branding', 'branding', true)
on conflict (id) do nothing;
