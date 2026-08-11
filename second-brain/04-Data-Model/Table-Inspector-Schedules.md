---
tags: [data-model, table]
status: active
created: 2026-08-08
updated: 2026-08-08
---

# Table: inspector_schedules

The PuLP-optimized weekly deployment output, mirrored from `ml-service/artifacts/inspector_schedule.csv` — see [[../03-ML-Pipeline/Stage8-Optimization-Engine]] for how these rows are computed.

## Key columns

- `project_id`, `inspector_id`, `scheduled_day` (Mon–Fri), `week_of`, `cluster`.
- `unique (project_id, scheduled_day, week_of)` — a project can't be double-booked for the same day/week regardless of which inspector it's assigned to. This also lets the manual schedule-editing feature safely reassign a project's day/inspector: a colliding UPDATE fails loudly (Postgres 23505) instead of silently creating a duplicate visit.

## RLS

Managers: full access. Inspectors: read their own rows only (`inspector_id = auth.uid()`).
