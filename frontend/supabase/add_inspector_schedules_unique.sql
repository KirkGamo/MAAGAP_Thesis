-- Phase 12.2: prevent a project from being double-booked on the same
-- day/week, regardless of inspector. Run this against the live Supabase
-- project (SQL Editor) before using the manual schedule-editing feature on
-- /manager/schedule -- it's what lets "reassign inspector/day" be a plain
-- UPDATE that fails loudly on a real conflict instead of silently
-- duplicating a visit.
--
-- If this fails with "could not create unique index ... duplicate key
-- value violates" it means the live table already has genuine duplicate
-- rows (e.g. from re-running an older, less careful deploy path) -- those
-- must be de-duplicated manually first; this script does not attempt to
-- resolve that for you.

-- Postgres has no "ADD CONSTRAINT IF NOT EXISTS", so guard manually.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.inspector_schedules'::regclass
      and conname = 'inspector_schedules_project_day_week_key'
  ) then
    alter table public.inspector_schedules
      add constraint inspector_schedules_project_day_week_key
      unique (project_id, scheduled_day, week_of);
  end if;
end $$;

-- Verify:
select conname
from pg_constraint
where conrelid = 'public.inspector_schedules'::regclass
  and conname = 'inspector_schedules_project_day_week_key';
