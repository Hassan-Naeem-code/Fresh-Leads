-- search_index: the owned index's only query.
--
-- It translates what lib/niche.ts asks Overpass into a question about our own table.
-- A mistranslation returns a plausible, wrong set of businesses, and neither we nor the
-- customer could tell from looking at the results, so every shape the parser emits is
-- exercised here against real rows.

\set QUIET on
set client_min_messages to notice;

do $$
declare
  n integer;
begin
  insert into public.indexed_businesses (osm_id, name, category, tags, lat, lon, metro) values
    ('node/1', 'Blue Door Bakery',      'bakery',     '{"shop":"bakery"}',                          30.30, -97.70, 'austin'),
    ('node/2', 'Gluten Free Goods',     'bakery',     '{"shop":"bakery"}',                          30.31, -97.71, 'austin'),
    ('node/3', 'Tokyo Sushi',           'restaurant', '{"amenity":"restaurant","cuisine":"sushi"}',  30.32, -97.72, 'austin'),
    ('node/4', 'Nobu',                  'restaurant', '{"amenity":"restaurant","cuisine":"japanese"}',30.33, -97.73, 'austin'),
    ('node/5', 'Joe''s Diner',          'restaurant', '{"amenity":"restaurant","cuisine":"burger"}', 30.34, -97.74, 'austin'),
    ('node/6', 'Far Away Bakery',       'bakery',     '{"shop":"bakery"}',                          47.60, -122.33,'seattle'),
    ('node/7', 'Ace Locksmith',         'locksmith',  '{"shop":"locksmith"}',                       30.35, -97.75, 'austin');

  -- A plain tag selector, inside the box.
  select count(*) into n from public.search_index(30.0, 30.5, -98.0, -97.5,
    '[{"key":"shop","value":"bakery","extra_key":null,"extra_pattern":null}]'::jsonb, 100);
  assert n = 2, 'expected 2 Austin bakeries, got ' || n;
  raise notice 'PASS a tag selector returns the businesses carrying that tag';

  -- THE BOX IS A FILTER, not a suggestion. The Seattle bakery must not appear in an
  -- Austin search, or an indexed search silently returns businesses from another state.
  select count(*) into n from public.search_index(30.0, 30.5, -98.0, -97.5,
    '[{"key":"shop","value":"bakery","extra_key":null,"extra_pattern":null}]'::jsonb, 100);
  assert n = 2, 'the bounding box must exclude other metros';
  raise notice 'PASS the bounding box excludes businesses outside it';

  -- A category narrowed by business name.
  select count(*) into n from public.search_index(30.0, 30.5, -98.0, -97.5,
    '[{"key":"shop","value":"bakery","extra_key":"name","extra_pattern":"gluten"}]'::jsonb, 100);
  assert n = 1, 'expected only the gluten free bakery, got ' || n;
  raise notice 'PASS a name pattern narrows within the category';

  -- Case insensitivity, because Overpass selectors carry the ",i" flag and a customer
  -- typing "gluten" must match "Gluten Free Goods".
  select count(*) into n from public.search_index(30.0, 30.5, -98.0, -97.5,
    '[{"key":"shop","value":"bakery","extra_key":"name","extra_pattern":"GLUTEN"}]'::jsonb, 100);
  assert n = 1, 'name matching must be case insensitive';
  raise notice 'PASS name matching is case insensitive';

  -- A cuisine alternation, which is how "sushi restaurant" finds Nobu: the tag knows
  -- what it serves even though the name never says sushi.
  select count(*) into n from public.search_index(30.0, 30.5, -98.0, -97.5,
    '[{"key":"amenity","value":"restaurant","extra_key":"cuisine","extra_pattern":"sushi|japanese"}]'::jsonb, 100);
  assert n = 2, 'expected both sushi and japanese, got ' || n;
  raise notice 'PASS a secondary tag pattern matches an alternation';

  -- "Any value" is the fallback shape for niches with no tag convention.
  select count(*) into n from public.search_index(30.0, 30.5, -98.0, -97.5,
    '[{"key":"shop","value":null,"extra_key":"name","extra_pattern":"locksmith"}]'::jsonb, 100);
  assert n = 1, 'expected the locksmith via the any-value fallback, got ' || n;
  raise notice 'PASS the any-value fallback matches on name across a whole tag key';

  -- Several selectors are a UNION, exactly as an Overpass filter list is.
  select count(*) into n from public.search_index(30.0, 30.5, -98.0, -97.5,
    '[{"key":"shop","value":"bakery","extra_key":null,"extra_pattern":null},
      {"key":"shop","value":"locksmith","extra_key":null,"extra_pattern":null}]'::jsonb, 100);
  assert n = 3, 'expected bakeries and the locksmith, got ' || n;
  raise notice 'PASS multiple selectors union rather than intersect';

  -- The limit is honoured and bounded, so a caller cannot ask for the whole table.
  select count(*) into n from public.search_index(30.0, 30.5, -98.0, -97.5,
    '[{"key":"shop","value":"bakery","extra_key":null,"extra_pattern":null}]'::jsonb, 1);
  assert n = 1, 'the limit must be honoured, got ' || n;
  raise notice 'PASS the row limit is honoured';

  -- A tag nobody has returns nothing rather than everything, which is the failure mode
  -- that would matter: a selector that silently matches all rows.
  select count(*) into n from public.search_index(30.0, 30.5, -98.0, -97.5,
    '[{"key":"shop","value":"submarine","extra_key":null,"extra_pattern":null}]'::jsonb, 100);
  assert n = 0, 'an unmatched selector must return nothing, got ' || n;
  raise notice 'PASS an unmatched selector returns nothing, not everything';
end $$;

-- ---------------------------------------------------------------------------
-- finish_ingest is what marks a metro trustworthy, so it is worth pinning.
-- ---------------------------------------------------------------------------
do $$
declare
  c integer; ing boolean;
begin
  insert into public.indexed_areas (metro, south, north, west, east, ingesting)
  values ('austin', 30.0, 30.5, -98.0, -97.5, true);

  perform public.finish_ingest('austin', 4200);

  select business_count, ingesting into c, ing from public.indexed_areas where metro = 'austin';
  assert c = 4200, 'the row count should be recorded, got ' || c;
  assert ing = false, 'finishing an ingest must clear the in-progress flag';
  assert (select last_ingested from public.indexed_areas where metro = 'austin') is not null,
    'finishing an ingest must stamp the time, since staleness is judged from it';
  raise notice 'PASS finishing an ingest records the count, the time, and clears the flag';
end $$;
