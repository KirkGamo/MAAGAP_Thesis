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
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Everyone can read their own profile (needed by layouts to check role).
create policy "profiles: read own"
  on public.profiles for select
  using (auth.uid() = id);

-- Managers can read every profile (needed to list/assign inspectors).
create policy "profiles: managers read all"
  on public.profiles for select
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'manager'
    )
  );

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
  created_at timestamptz not null default now()
);

alter table public.projects enable row level security;

-- Managers have full read/write access.
create policy "projects: managers full access"
  on public.projects for all
  using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'manager')
  )
  with check (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'manager')
  );

-- Inspectors can only READ projects they are currently scheduled against
-- (join through inspector_schedules) — never the full backlog, and never
-- write access to project records themselves.
create policy "projects: inspectors read assigned"
  on public.projects for select
  using (
    exists (
      select 1 from public.inspector_schedules s
      where s.project_id = projects.id and s.inspector_id = auth.uid()
    )
  );

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
  created_at timestamptz not null default now()
);

alter table public.inspector_schedules enable row level security;

create policy "schedules: managers full access"
  on public.inspector_schedules for all
  using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'manager')
  )
  with check (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'manager')
  );

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
  using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'manager')
  );

create policy "reports: inspectors insert own"
  on public.monitoring_reports for insert
  with check (inspector_id = auth.uid());

create policy "reports: inspectors read own"
  on public.monitoring_reports for select
  using (inspector_id = auth.uid());
