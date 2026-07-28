-- MAAGAP Supabase schema: profiles (RBAC), projects, inspector schedules,
-- and monitoring reports (the field-inspector feedback loop).
--
-- Run this against a fresh Supabase project (SQL Editor, or
-- `supabase db push` if you're using the CLI with migrations). After
-- running it, regenerate src/types/database.ts from the live schema:
--   supabase gen types typescript --project-id <ref> > src/types/database.ts

-- ---------------------------------------------------------------------
-- profiles: one row per auth.users row, carrying the Manager/Inspector role
-- ---------------------------------------------------------------------
create type user_role as enum ('manager', 'inspector');

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  role user_role not null default 'inspector',
  -- Phase 12: gates portal access (see lib/auth.ts's requireRole()) and
  -- lets a Manager deactivate an Inspector from the new Inspectors tab
  -- without deleting their account/history (inspector_schedules and
  -- monitoring_reports both foreign-key to this row -- deleting it would
  -- cascade-delete real field-report history). Defaults true so every
  -- existing/new account stays usable unless explicitly deactivated.
  active boolean not null default true,
  -- Phase 12.1: maps a real Inspector profile to one of
  -- ml-service/optimization_engine.py's fixed synthetic roster slots
  -- ("Inspector_1".."Inspector_6", see that file's INSPECTOR_COUNT/
  -- INSPECTOR_IDS constants). The PuLP solve plans against a fixed number
  -- of budgeted inspector slots without knowing which real person fills
  -- each one -- this column is that missing link, letting
  -- actions/deploy-schedule.ts translate the optimizer's CSV output into
  -- real inspector_schedules rows. Nullable + unique: not every profile
  -- needs a slot (only the ones actually deployed against), and two
  -- profiles can't claim the same slot.
  inspector_slug text unique,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Everyone can read their own profile (needed by layouts to check role).
create policy "profiles: read own"
  on public.profiles for select
  using (auth.uid() = id);

-- "Is the current user a manager?" helper, used by every "managers full
-- access" policy below (profiles/projects/inspector_schedules/
-- monitoring_reports). MUST be `security definer` so its internal query
-- runs as the function owner and bypasses RLS entirely -- if this were a
-- plain inline `exists (select 1 from public.profiles ...)` subquery
-- directly inside a policy ON public.profiles (as an earlier version of
-- this schema had it), Postgres has to re-apply profiles' RLS to resolve
-- that subquery, which re-triggers the very same policy, which queries
-- profiles again... "infinite recursion detected in policy for relation
-- profiles" on every single select against profiles (this was a real bug
-- caught in Phase 8.5: every login appeared to succeed but every
-- subsequent request bounced back to /login, because the profile lookup
-- inside requireRole() was failing with exactly this Postgres error).
create function public.is_manager()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and role = 'manager'
  );
$$;

-- Managers can read every profile (needed to list/assign inspectors).
create policy "profiles: managers read all"
  on public.profiles for select
  using (public.is_manager());

-- Managers can update every profile (Phase 12: needed for the Inspectors
-- tab's activate/deactivate toggle). No UPDATE policy on profiles existed
-- before this -- the only prior write path was handle_new_user()'s
-- trigger, which is security definer and bypasses RLS entirely, so this
-- gap was never hit until a Manager-initiated update was needed.
create policy "profiles: managers update all"
  on public.profiles for update
  using (public.is_manager())
  with check (public.is_manager());

-- Auto-create a profile row (defaulting to 'inspector') whenever a new
-- auth.users row is created. Promote a user to 'manager' manually via the
-- Supabase dashboard/SQL editor, or extend this trigger with your own
-- invite-code logic.
create function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, full_name, role)
  values (new.id, new.raw_user_meta_data ->> 'full_name', 'inspector');
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ---------------------------------------------------------------------
-- projects: mirrors the ml-service's project_key / risk-scoring output
-- ---------------------------------------------------------------------
create type project_status as enum (
  'not_yet_implemented', 'on_going', 'completed', 'for_bidding'
);

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  project_key text not null unique,
  name_of_project text not null,
  location text not null,
  municipality text,
  amount_php numeric,
  status project_status not null default 'not_yet_implemented',
  date_released date,
  date_of_completion date,
  project_type text not null default 'Unclassified'
    check (project_type in ('Infrastructure', 'Non-Infrastructure', 'Unclassified')),
  risk_tier text
    check (risk_tier in ('Low', 'Medium', 'High', 'Critical')),
  risk_probability numeric check (risk_probability between 0 and 1),
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  -- Phase 12.3: real, geocoded site coordinates (see
  -- scripts/geocode_projects.py, which resolves these from the `location`
  -- text field via the Nominatim/OpenStreetMap geocoder). Nullable and
  -- deliberately separate from `municipality`'s town-center approximation
  -- (lib/municipality-coordinates.ts) -- every map view
  -- (project-risk-map.tsx, ppas/page.tsx, schedule-map.tsx) prefers these
  -- when present and only falls back to the jittered municipality center
  -- (lib/pin-jitter.ts) when a project hasn't been geocoded yet. Standard
  -- lat/lng bounds, not province-specific -- a tighter check here would
  -- reject a legitimately mis-entered `location` loudly at write time
  -- instead of just leaving it ungeocoded, which is not this constraint's
  -- job (the geocoding script already sanity-checks against Iloilo's
  -- bounding box before writing).
  latitude numeric check (latitude between -90 and 90),
  longitude numeric check (longitude between -180 and 180)
);

alter table public.projects enable row level security;

-- Managers have full read/write access.
create policy "projects: managers full access"
  on public.projects for all
  using (public.is_manager())
  with check (public.is_manager());

-- NOTE: the "inspectors read assigned" policy on public.projects is
-- defined further down, right after public.inspector_schedules is
-- created — a CREATE POLICY's USING clause is resolved at creation time,
-- so it cannot reference a table that doesn't exist yet. (Originally this
-- policy was placed here, before inspector_schedules existed, which fails
-- with "relation public.inspector_schedules does not exist" — moved below
-- to fix that ordering bug.)

-- ---------------------------------------------------------------------
-- inspector_schedules: the PuLP-optimized weekly deployment output,
-- mirrored from ml-service/artifacts/inspector_schedule.csv
-- ---------------------------------------------------------------------
create table if not exists public.inspector_schedules (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  inspector_id uuid not null references public.profiles (id),
  scheduled_day text not null check (scheduled_day in ('Mon', 'Tue', 'Wed', 'Thu', 'Fri')),
  week_of date not null,
  cluster text,
  created_at timestamptz not null default now(),
  -- Phase 12.2: a given project should not be double-booked for the same
  -- day/week -- regardless of which inspector it's assigned to. This also
  -- gives the manual schedule-editing feature (actions/schedule.ts) a safe
  -- target for "reassign this project's day/inspector" without first
  -- deleting the old row: an UPDATE that collides with another existing
  -- assignment now fails loudly (23505) instead of silently creating a
  -- duplicate visit.
  unique (project_id, scheduled_day, week_of)
);

alter table public.inspector_schedules enable row level security;

-- Inspectors can only READ projects they are currently scheduled against
-- (join through inspector_schedules) — never the full backlog, and never
-- write access to project records themselves. Defined here (not up next
-- to projects' other policy) because it depends on this table existing.
create policy "projects: inspectors read assigned"
  on public.projects for select
  using (
    exists (
      select 1 from public.inspector_schedules s
      where s.project_id = projects.id and s.inspector_id = auth.uid()
    )
  );

create policy "schedules: managers full access"
  on public.inspector_schedules for all
  using (public.is_manager())
  with check (public.is_manager());

create policy "schedules: inspectors read own"
  on public.inspector_schedules for select
  using (inspector_id = auth.uid());

-- ---------------------------------------------------------------------
-- monitoring_reports: the ML feedback loop — an inspector's field report,
-- which actions/submit-report.ts writes and later feeds back into
-- ml-service retraining (see that file's module docstring).
-- ---------------------------------------------------------------------
create table if not exists public.monitoring_reports (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  inspector_id uuid not null references public.profiles (id),
  visited_at timestamptz not null default now(),
  status_observed project_status not null,
  percent_complete numeric check (percent_complete between 0 and 100),
  remarks text,
  photo_urls text[],
  created_at timestamptz not null default now()
);

alter table public.monitoring_reports enable row level security;

create policy "reports: managers read all"
  on public.monitoring_reports for select
  using (public.is_manager());

create policy "reports: inspectors insert own"
  on public.monitoring_reports for insert
  with check (inspector_id = auth.uid());

create policy "reports: inspectors read own"
  on public.monitoring_reports for select
  using (inspector_id = auth.uid());
