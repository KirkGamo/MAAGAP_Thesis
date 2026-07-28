-- MAAGAP migration: adds profiles.inspector_slug
-- ================================================================================
-- Fix for "Deploy latest schedule" doing nothing (the button silently
-- returned an error because deployLatestSchedule() was an unimplemented
-- placeholder -- see actions/deploy-schedule.ts). Implementing it for
-- real requires a way to map ml-service/optimization_engine.py's fixed
-- synthetic roster slots ("Inspector_1".."Inspector_6") to real Inspector
-- profiles, which is what this column is for.
--
-- Run this in the Supabase SQL Editor against an already-provisioned
-- project. Safe to re-run: the column add is idempotent.

alter table public.profiles
  add column if not exists inspector_slug text unique;

-- Verification
select id, full_name, role, active, inspector_slug from public.profiles order by created_at;
