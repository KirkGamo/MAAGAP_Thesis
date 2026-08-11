---
tags: [moc, architecture]
status: active
created: 2026-08-08
updated: 2026-08-08
---

# MOC — Architecture

MAAGAP is four layers that stay deliberately decoupled: a Next.js dashboard, a Python ML pipeline that runs offline (not a live inference API for most flows), a Supabase Postgres database as the single source of truth, and a separate deployment story for each half.

- [[01-Architecture/Frontend-Nextjs|Frontend: Next.js]] — App Router, Tailwind, Shadcn UI, Tremor; Manager and Inspector portals.
- [[01-Architecture/Backend-MLService|Backend: ml-service (FastAPI + pipeline scripts)]] — the data pipeline, model training scripts, optimization engine, and a thin FastAPI feedback-loop service.
- [[01-Architecture/Database-Supabase|Database: Supabase]] — Postgres schema, auth, and how ml-service writes scores back in.
- [[01-Architecture/RBAC-and-RLS|RBAC and Row Level Security]] — Manager vs Inspector roles, and the RLS-recursion bug that shaped how policies are written now.
- [[01-Architecture/Deployment|Deployment]] — Vercel for the frontend, containerized/separately-hosted ml-service.

See also [[MOC-Data-Model]] for the schema itself and [[MOC-ML-Pipeline]] for what actually runs inside ml-service.
