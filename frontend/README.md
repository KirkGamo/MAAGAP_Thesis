# MAAGAP Frontend

Next.js (App Router) + Tailwind CSS + Shadcn-style components + Supabase, implementing
the production workflow described in Chapter 3: Manager and Inspector portals sitting
on top of the `ml-service/` ML pipeline and PuLP optimization engine.

## Stack

- **Next.js 16** (App Router, `proxy.ts` — Next 16 renamed `middleware.ts`)
- **Tailwind CSS v4**
- **Shadcn-style UI primitives** — hand-authored under `src/components/ui/` following
  the standard shadcn source pattern (`cva` variants, `cn()` helper), so `npx shadcn@latest add <component>`
  can be used going forward to add more without conflicting with what's here.
- **Supabase** (`@supabase/ssr`) for auth, Postgres, and Row Level Security-enforced RBAC

## Getting started

```bash
npm install
cp .env.local.example .env.local   # fill in your Supabase project's URL/keys
npm run dev
```

Then, against a fresh Supabase project, run `supabase/schema.sql` (SQL Editor, or
`supabase db push` if using the CLI) to create the `profiles`, `projects`,
`inspector_schedules`, and `monitoring_reports` tables and their RLS policies. New
sign-ups default to the `inspector` role (see `handle_new_user()` in that file) —
promote a user to `manager` by updating their `profiles.role` row directly.

Regenerate `src/types/database.ts` from the live schema once it's running:

```bash
supabase gen types typescript --project-id <ref> > src/types/database.ts
```

## Architecture

```
proxy.ts                      Next 16's middleware.ts equivalent — refreshes the
                               Supabase session cookie only. Role checks live in
                               layouts instead (see lib/auth.ts's requireRole()).
src/lib/supabase/
  client.ts                   Browser client (Client Components)
  server.ts                   Server client (Server Components/Actions) + a
                               service-role client for trusted server-only writes
  proxy.ts                    updateSession() used by the root proxy.ts
src/lib/auth.ts                requireRole() — the actual RBAC enforcement point
src/app/
  login/                      Shared sign-in screen for both roles
  page.tsx                    Root route: redirects to /manager or /inspector
                               based on the signed-in user's profiles.role
  manager/                    Manager portal (desktop-oriented)
    import/                   CSV upload (Papaparse, client-side) + manual entry
    backlog/                  Filterable project table + per-project detail view
    schedule/                 Read/deploy the PuLP-optimized weekly schedule
  inspector/                  Inspector portal (mobile-first)
    page.tsx                  Today's assigned route
    report/[projectId]/       Monitoring report submission form
src/actions/
  projects.ts                 Manager: createProject, importProjectsCsv
  deploy-schedule.ts          PLACEHOLDER — see its module docstring for the
                               remaining steps to wire it to ml-service's output
  submit-report.ts            The ML feedback loop. Fully implemented for the
                               Supabase write; the webhook call to the FastAPI
                               ML service is a documented placeholder — see its
                               module docstring for the full intended contract.
supabase/schema.sql            Tables + RLS policies (the RBAC enforcement layer
                               referenced throughout this app)
```

## What's real vs. placeholder here

Everything under `src/lib`, `src/app`, and the Supabase schema is a working
implementation you can run against a real Supabase project today. Two integration
points are deliberately left as documented placeholders, since they depend on a
FastAPI endpoint that doesn't exist in `ml-service/` yet:

- `src/actions/submit-report.ts`'s webhook call to `${FASTAPI_ML_SERVICE_URL}/webhooks/monitoring-report`
- `src/actions/deploy-schedule.ts`'s ingestion of `ml-service/artifacts/inspector_schedule.csv`

Both files' module docstrings spell out exactly what the FastAPI side needs to expose
for these to become real integrations rather than stubs.
