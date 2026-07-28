-- MAAGAP migration: adds profiles.active + the managers-update-all policy
-- ================================================================================
-- Phase 12. Run this in the Supabase SQL Editor against an already-
-- provisioned project that ran an earlier version of schema.sql (which
-- didn't have profiles.active or a manager UPDATE policy on profiles).
-- Safe to re-run: the column add and policy are both idempotent.

alter table public.profiles
  add column if not exists active boolean not null default true;

drop policy if exists "profiles: managers update all" on public.profiles;
create policy "profiles: managers update all"
  on public.profiles for update
  using (public.is_manager())
  with check (public.is_manager());

-- Verification
select id, full_name, role, active from public.profiles order by created_at;
