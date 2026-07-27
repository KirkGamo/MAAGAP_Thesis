-- MAAGAP: Fix infinite-recursion RLS bug (Phase 8.5 follow-up)
-- ================================================================================
-- Run this in the Supabase SQL Editor against your ALREADY-provisioned
-- project (the one where you already ran schema.sql). It fixes the actual
-- cause of the login redirect loop:
--
-- Four policies (on profiles/projects/inspector_schedules/monitoring_reports)
-- checked "is this user a manager?" with an inline subquery like:
--     exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'manager')
-- placed directly inside a policy ON public.profiles itself. Every time
-- Postgres evaluates that policy, it has to run a query against
-- public.profiles to resolve the subquery -- which re-triggers the same
-- policy -- which queries profiles again... Postgres detects this and
-- raises "infinite recursion detected in policy for relation profiles" on
-- EVERY select against profiles, for every user, regardless of role. That
-- is why sign-in appeared to succeed (the Supabase Auth call itself has
-- nothing to do with RLS) but the very next profiles lookup -- which
-- requireRole() in lib/auth.ts needs to decide Manager vs. Inspector --
-- failed, and the app treated that failure as "not signed in" and bounced
-- back to /login. The manager account landing on /inspector first
-- (before bouncing) was app/page.tsx's root redirect silently defaulting
-- to "/inspector" whenever the profile lookup came back empty/errored,
-- which masked the same underlying failure.
--
-- The fix: move the "is this user a manager" check into a SECURITY
-- DEFINER function. Its internal query runs as the function owner and
-- bypasses RLS entirely, so it never re-triggers the policy that calls it.

-- ---------------------------------------------------------------------
-- 1. Create the helper function
-- ---------------------------------------------------------------------
create or replace function public.is_manager()
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

-- ---------------------------------------------------------------------
-- 2. Replace the four recursive policies
-- ---------------------------------------------------------------------
drop policy if exists "profiles: managers read all" on public.profiles;
create policy "profiles: managers read all"
  on public.profiles for select
  using (public.is_manager());

drop policy if exists "projects: managers full access" on public.projects;
create policy "projects: managers full access"
  on public.projects for all
  using (public.is_manager())
  with check (public.is_manager());

drop policy if exists "schedules: managers full access" on public.inspector_schedules;
create policy "schedules: managers full access"
  on public.inspector_schedules for all
  using (public.is_manager())
  with check (public.is_manager());

drop policy if exists "reports: managers read all" on public.monitoring_reports;
create policy "reports: managers read all"
  on public.monitoring_reports for select
  using (public.is_manager());

-- ---------------------------------------------------------------------
-- 3. Verify: this should now return your manager row with role='manager',
--    with NO "infinite recursion" error.
-- ---------------------------------------------------------------------
select id, full_name, role
from public.profiles
where id = (select id from auth.users where email = 'manager@maagap.test');
