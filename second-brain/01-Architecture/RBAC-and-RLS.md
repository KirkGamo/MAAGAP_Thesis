---
tags: [architecture, security, rls]
status: active
created: 2026-08-08
updated: 2026-08-08
---

# RBAC and Row Level Security

Two roles: `manager` and `inspector` (`profiles.role`, a Postgres enum). Every table's RLS policy pattern is built around a single `security definer` helper function, `public.is_manager()`.

## The recursion bug that shaped this pattern

An earlier version of the schema wrote each "managers full access" policy as an inline subquery directly against `profiles` (`exists (select 1 from public.profiles where id = auth.uid() and role = 'manager')`). Because that subquery itself hits `profiles`, and `profiles` has its own RLS policies, Postgres has to re-apply RLS to resolve the subquery — which re-triggers the same policy — infinite recursion. Symptom in production: every login *appeared* to succeed, but every subsequent request bounced back to `/login`, because the profile lookup inside `requireRole()` silently failed with `infinite recursion detected in policy for relation profiles`.

Fix: `public.is_manager()` is `security definer`, so its internal query runs as the function owner and bypasses RLS entirely. Every policy that needs "is the current user a manager" calls this function instead of inlining the subquery. This is now the standard pattern for any new role-gated table.

## What each role can actually see

- **Manager**: full read/write on `projects`, `inspector_schedules`; read on all `profiles` and `monitoring_reports`; update on `profiles` (Inspector activate/deactivate toggle).
- **Inspector**: read-only, and only on rows tied to them — `projects` filtered to ones they're scheduled against (`exists` join through `inspector_schedules`), own `inspector_schedules` rows, own `profiles` row, insert/read own `monitoring_reports`.

See [[../04-Data-Model/Table-Profiles]] for the `inspector_slug` column that links a real Inspector profile to the optimizer's fixed synthetic roster slots.
