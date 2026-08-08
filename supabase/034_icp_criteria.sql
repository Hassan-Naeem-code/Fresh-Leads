-- ---------------------------------------------------------------------------
-- 034. ICP CRITERIA ON THE BUYER PROFILE
--
-- Migration 007 saved what the customer SELLS, on the reasoning that it was "the
-- single most important fact about a customer" and therefore belonged in the database
-- rather than in client state that resets on reload. That reasoning was right and it
-- was applied to half the sentence.
--
-- The other half is the qualifying requirements: "no online ordering", "at least 4
-- stars", "family owned". lib/icp-match.ts screens every discovered business against
-- them and they decide the ranking, but they lived only in React state. Describe your
-- ideal customer, refresh the page, and the search silently reverts to the whole
-- category, with nothing on screen to say the requirements had been dropped.
--
-- That is the same failure 007 was written to fix, so it gets the same fix.
--
-- STORED AS text[], matching `targets` directly above them. These are short phrases in
-- the customer's own words, never structured objects: lib/icp-match.ts re-reads the
-- phrasing (including words like "no" and "without", which carry the whole meaning) on
-- every search, so parsing them into a schema here would throw away the only thing
-- that makes them checkable.
-- ---------------------------------------------------------------------------

alter table public.profiles
  -- Qualifying requirements, one short phrase each, verbatim.
  add column if not exists icp_criteria text[],
  -- Business kinds ruled out entirely. Kept apart from criteria because they are not a
  -- preference to be traded off against a good rating (see isExcluded in icp-match).
  add column if not exists icp_excludes text[];

-- A bound, so a pathological parse cannot write an unbounded array into every search.
-- The application already slices to 12; this is the guarantee behind that.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_icp_criteria_bounded') then
    alter table public.profiles
      add constraint profiles_icp_criteria_bounded check (
        (icp_criteria is null or array_length(icp_criteria, 1) <= 12)
        and (icp_excludes is null or array_length(icp_excludes, 1) <= 12)
      );
  end if;
end $$;
