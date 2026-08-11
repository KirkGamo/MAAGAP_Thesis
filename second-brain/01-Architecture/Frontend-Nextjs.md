---
tags: [architecture, frontend]
status: active
created: 2026-08-08
updated: 2026-08-08
---

# Frontend: Next.js

Next.js 16 (App Router), React 19, Tailwind CSS 4, Shadcn UI for core components, Tremor-style data visualization, TanStack Table for the PPAs data grid, Leaflet/react-leaflet for maps, Recharts for charts. Deployed to Vercel — see [[Deployment]].

## Two portals, one app

- **Manager portal** (`frontend/src/app/manager/`): Overview (KPI header), PPAs (the main project list — table/map views, filters, CSV export, manual entry/import), Inspectors (roster, activate/deactivate), Schedule (the PuLP-generated weekly deployment, viewable and manually editable), Models (training metrics display), Reports, Monitoring.
- **Inspector portal** (`frontend/src/app/inspector/`): a scoped-down view — an inspector sees only projects they're currently scheduled against (enforced at the RLS layer, see [[RBAC-and-RLS]]), and can file a field monitoring report.

## The PPAs tab is the center of gravity

`frontend/src/app/manager/ppas/` is the most-iterated part of the frontend: table view (`columns.tsx`, `data-table.tsx`), map view, filter sidebar (`ppa-filter-sidebar.tsx` — multi-select facets, range sliders), search, CSV export (`export/route.ts`, a Route Handler so it can be a plain download link honoring the exact same filters as the table), and manual/CSV import (`import/manual-entry-form.tsx`, `ppa-import-panel.tsx`). The project detail page (`ppas/[projectId]/page.tsx`) shows risk classification, SHAP feature explanations, and status-aware messaging (see [[../02-Decisions/D05-Refunded-Status]] and [[../02-Decisions/D01-Proxy-Completion-Dates]] for why "completed" and "refunded" projects get different banners than a flagged-risk ongoing project).

## Data flow

The frontend never calls ml-service directly for most reads — it reads `projects`/`inspector_schedules`/`monitoring_reports` straight from Supabase (see [[../04-Data-Model/Table-Projects]]). ml-service writes risk scores into `projects` via `scripts/seed_supabase.py` as a batch job, not a live API call per page load. The one exception is live single-project rescoring (SHAP recompute) — see [[../02-Decisions/D08-SHAP-Explainability]].
