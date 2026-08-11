---
tags: [data-model, table]
status: active
created: 2026-08-08
updated: 2026-08-08
---

# Table: profiles

One row per `auth.users` row, auto-created via the `handle_new_user()` trigger on signup (defaults to `inspector` role — promote to `manager` manually via the Supabase dashboard/SQL editor).

## Key columns

- `role` (`user_role` enum: `manager`, `inspector`).
- `active` (boolean, default true) — lets a Manager deactivate an Inspector from the Inspectors tab without deleting the account (deleting would cascade-delete real field-report history via foreign keys).
- `inspector_slug` (nullable, unique) — maps a real Inspector profile to one of `optimization_engine.py`'s fixed synthetic roster slots (`Inspector_1`..`Inspector_6`). The PuLP solve plans against a fixed number of budgeted inspector slots without knowing which real person fills each one; this column is the missing link that lets the schedule-deployment action translate the optimizer's CSV output into real `inspector_schedules` rows.

## RLS

Everyone reads their own profile. Managers read/update all profiles. See [[../01-Architecture/RBAC-and-RLS]] for the `is_manager()` recursion story behind this pattern.
