---
tags: [decision, frontend, data-model]
status: active
created: 2026-08-08
updated: 2026-08-08
---

# D05: Adding a "Refunded" Project Status

## Context

A fund transfer's activity can be refunded — money returned rather than liquidated against completed work (Fund Transfer Con's Amount Refunded column, monitoring sheet STATUS values like "Refunded"/"For refund of full amount"). Before this decision, `scripts/seed_supabase.py`'s `map_status()` had no substring match for "refund", so these rows silently fell through to `not_yet_implemented`/`on_going` — misleading, since a refunded activity's funds are gone, it isn't awaiting future work.

## Options considered

1. Leave it mapped to `on_going` (status quo, misleading).
2. Add a UI-only label without a real backend status distinction.
3. Add a proper `refunded` enum value across the full stack.

## Decision

Option 3. `project_status` enum gained `'refunded'` (`add_refunded_status.sql`); `map_status()` in `seed_supabase.py` now recognizes it; frontend types, badges (`statusRefunded`, rose-colored), filters, manual-entry form, and CSV export all updated to match.

## Why

A refunded project is a genuinely different state from either "not yet started" or "currently in progress" — conflating it with either misleads a Manager reading the dashboard about what actually happened to that money. This also fed directly into [[D06-Status-Excludes-Scheduling]]: once refunded is a real status, it can be correctly excluded from "should an inspector visit this" scheduling logic, same as completed. See the schema migration gotcha in [[../01-Architecture/Database-Supabase]] — the `alter type ... add value` had to run as its own execution, separate from any verify query, which wasn't obvious the first time.
