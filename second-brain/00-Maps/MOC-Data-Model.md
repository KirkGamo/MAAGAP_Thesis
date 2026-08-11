---
tags: [moc, data-model]
status: active
created: 2026-08-08
updated: 2026-08-08
---

# MOC — Data Model

- [[04-Data-Model/Table-Projects|projects]] — mirrors ml-service's project_key/risk-scoring output; the table both portals read from.
- [[04-Data-Model/Table-Profiles|profiles]] — one row per auth.users row, carries Manager/Inspector role and the inspector_slug link to the optimizer's synthetic roster.
- [[04-Data-Model/Table-Inspector-Schedules|inspector_schedules]] — the PuLP-optimized weekly deployment output.
- [[04-Data-Model/Table-Monitoring-Reports|monitoring_reports]] — the field-inspector feedback loop, written through the Inspector portal.
- [[04-Data-Model/Glossary|Glossary]] — PPA, PPDO, D_start, T_standard, proxy date, and every other term that means something specific in this project and nowhere else.

Full schema source of truth: `frontend/supabase/schema.sql`. This MOC and its notes explain *why* the schema looks the way it does (especially the RLS policies) — see [[01-Architecture/RBAC-and-RLS]] for the recursion bug that shaped the `is_manager()` helper function pattern used throughout.
