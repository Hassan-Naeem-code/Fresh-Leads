-- ---------------------------------------------------------------------------
-- 007. BUYER PROFILE: what the user sells
--
-- The single most important thing to know about a customer, and until now it was
-- client-side state that reset on every reload. A Shift4 card-terminal reseller and
-- a web designer looking at the same restaurant want completely different leads, and
-- the playbook is what decides which signals are scored and shown (lib/playbooks.ts).
--
-- The free-text `sells` column is deliberately here even though nothing scores on it
-- yet: it is what the natural-language "describe your ideal customer" parser fills,
-- and what an outreach draft would use for context.
-- ---------------------------------------------------------------------------

alter table public.profiles
  add column if not exists playbook text,
  -- Their own words, e.g. "Shift4 card processing terminals for restaurants".
  add column if not exists sells text,
  -- Business types they target. Free-form: their niche may not be in our list.
  add column if not exists targets text[],
  -- Usual search area, prefilled on the dashboard.
  add column if not exists search_location text,
  add column if not exists profile_updated_at timestamptz;

-- Only ids the app actually knows how to score. Anything else would silently fall
-- back to the default playbook, which is a confusing way to fail.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_playbook_valid') then
    alter table public.profiles
      add constraint profiles_playbook_valid check (
        playbook is null or playbook in (
          'web_design', 'payments_pos', 'marketing_seo', 'booking_software', 'general_smb'
        )
      );
  end if;
end $$;

-- Keep the free-text fields from becoming a dumping ground.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_sells_length') then
    alter table public.profiles
      add constraint profiles_sells_length check (sells is null or length(sells) <= 500);
  end if;
end $$;

-- Users may read and update their own profile; RLS policies for profiles already
-- exist in schema.sql (owner keyed by id), so the new columns inherit them.
