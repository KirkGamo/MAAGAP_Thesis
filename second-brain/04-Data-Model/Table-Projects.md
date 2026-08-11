---
tags: [data-model, table]
status: active
created: 2026-08-08
updated: 2026-08-08
---

# Table: projects

The table both portals read from — mirrors ml-service's `project_key`/risk-scoring output. One row per PPA (Programs/Projects/Activities).

## Key columns

- `project_key` (unique) — the entity-resolution join key from [[../03-ML-Pipeline/Stage1-Preprocess|the crosswalk]].
- `status` (`project_status` enum: `not_yet_implemented`, `on_going`, `completed`, `for_bidding`, `refunded`) — see [[../02-Decisions/D05-Refunded-Status]].
- `date_released`, `date_of_completion` — direct dates when available.
- `date_last_monitored` — most recent DATE MONITORED from the source sheet; distinct from `monitoring_reports.visited_at` (new reports filed through this app, not historical field visits from the raw dataset).
- `project_type` — Infrastructure / Non-Infrastructure / Unclassified (drives `T_standard` in target construction, see [[../02-Decisions/D01-Proxy-Completion-Dates]]).
- `risk_tier` / `risk_probability` — meta-learner output, written by [[../03-ML-Pipeline/Stage7-Seed-Supabase]].
- `shap_top_features` (jsonb) — [[../02-Decisions/D08-SHAP-Explainability]].
- `latitude`/`longitude` — real geocoded coordinates (`scripts/geocode_projects.py`, Nominatim/OSM), nullable; every map view prefers these and falls back to a jittered municipality-center approximation when absent.

## RLS

Managers: full access. Inspectors: read-only, filtered to projects they're currently scheduled against (join through `inspector_schedules`). See [[../01-Architecture/RBAC-and-RLS]].
