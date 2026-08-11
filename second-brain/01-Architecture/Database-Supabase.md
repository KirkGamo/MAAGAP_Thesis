---
tags: [architecture, database, supabase]
status: active
created: 2026-08-08
updated: 2026-08-08
---

# Database: Supabase

Postgres via Supabase, used for both data storage and auth. Schema source of truth is `frontend/supabase/schema.sql`, with incremental `add_*.sql` migration files for changes made after the initial schema (each one a standalone, idempotent `alter table`/`alter type` statement — see [[../06-Operations/Git-Conventions]] and the enum-migration gotcha below).

## Four tables

`profiles`, `projects`, `inspector_schedules`, `monitoring_reports` — full detail in [[../MOC-Data-Model]]. Every table has Row Level Security enabled; see [[RBAC-and-RLS]] for the policy design and a real recursion bug it had to work around.

## Type safety

Drizzle ORM is specified in the project's stack guidelines for end-to-end type safety; `src/types/database.ts` (regenerated via `supabase gen types typescript`) is the actual TypeScript surface the frontend codes against today.

## Gotcha: enum migrations

Postgres will not let a newly-added enum value (`alter type ... add value`) be used in the same transaction it was added in, and the Supabase SQL Editor runs an entire pasted script as one transaction — so a migration file that adds an enum value AND queries it in the same execution fails with `unsafe use of new value ... New enum values must be committed before they can be used`. This bit the [[../02-Decisions/D05-Refunded-Status|refunded status]] rollout once. Always run the `alter type` as its own execution, verify separately afterward.

## Writes are batch, not per-request

ml-service writes to `projects` via `scripts/seed_supabase.py`, upserting in batches of 500 on `project_key` conflict. The frontend never writes risk scores itself.
