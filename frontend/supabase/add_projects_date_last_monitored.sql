-- Surfaces each project's most recent historical DATE MONITORED (from the
-- source monitoring sheet, via data/ready/inference.csv) on the PPAs list
-- table and detail page -- previously only visible by opening the raw
-- Excel export. Distinct from monitoring_reports.visited_at, which tracks
-- NEW reports filed through this app's Inspector feedback loop, not
-- historical field visits. Run this against the live Supabase project (SQL
-- Editor) before re-running scripts/seed_supabase.py with the updated
-- build_project_rows().

alter table public.projects
  add column if not exists date_last_monitored date;

-- Verify:
select column_name, data_type
from information_schema.columns
where table_schema = 'public' and table_name = 'projects'
  and column_name = 'date_last_monitored';
