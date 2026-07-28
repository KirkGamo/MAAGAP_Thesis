-- Phase 12.3: real, geocoded project coordinates -- replaces the
-- municipality-center-plus-jitter approximation used everywhere the map
-- renders (Risk Map, PPAs tab, Schedule tab) with an actual site location
-- when one is known. Run this against the live Supabase project (SQL
-- Editor) before running scripts/geocode_projects.py.

alter table public.projects
  add column if not exists latitude numeric check (latitude between -90 and 90),
  add column if not exists longitude numeric check (longitude between -180 and 180);

-- Verify:
select column_name, data_type
from information_schema.columns
where table_schema = 'public' and table_name = 'projects'
  and column_name in ('latitude', 'longitude');
