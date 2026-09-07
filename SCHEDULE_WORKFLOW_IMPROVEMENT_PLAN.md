# MAAGAP — Scheduling Workflow & Interface Improvement Plan

_Drafted 2026-09-08. Scope: the Manager Schedule tab (`frontend/src/app/manager/schedule/`), its server actions (`actions/schedule.ts`, `actions/deploy-schedule.ts`), and the optimization service surface (`ml-service/optimization_engine.py`, `ml-service/main.py`). Companion to `DASHBOARD_UI_IMPROVEMENT_PLAN.md`; reuses the single-viewport layout system proven on the Overview page._

---

## 1. Objectives

1. **Close the workflow loop.** Make the scheduler's entire journey — optimize → review → adjust → deploy — possible inside the app. Today the first and most important step (running the PuLP solve) requires a terminal; the UI even says so in its empty state ("Run `ml-service/optimization_engine.py`…"), which is a leaky abstraction no panelist will let pass.
2. **One screen, no scrolling.** The page currently stacks the edit table, a fixed 460px map, and a 5-column Kanban board into roughly four screens of vertical scrolling. Rebuild it on the same `100dvh` grid system as the Overview redesign: full-page screenshot height must equal viewport height at 1366×768 and up.
3. **Minimize information overload via progressive disclosure.** Show one day at a time by default (the day filter already exists but only drives the map), keep the week visible as compact per-day counts, and replace the always-visible editing table with on-demand inline editing. The manager's primary question is *"who goes where tomorrow, and is that good enough?"* — everything else is secondary.
4. **Make the optimization legible.** The solver already writes a summary (`solver_status`, `objective_value`, `candidate_projects`, `projects_scheduled`, `coverage_rate`, `critical_projects_scheduled`, `clusters_touched`) and the deploy action already fetches it — but nothing renders it. For a thesis whose Objective is prescriptive resource allocation, the UI must show *what the optimizer did and how well*.

**Non-goals:** changing the PuLP model itself (objective, constraints, capacities stay as-is); multi-week planning beyond an explicit week label; drag-and-drop (stretch goal only).

---

## 2. Current State

### 2.1 The scheduler's journey today (as-is)

| Step | Where | Pain |
|---|---|---|
| 1. Score + solve | **Terminal**: `python optimization_engine.py` | Outside the app entirely; no UI trigger, no progress, no result surface |
| 2. Map inspector slots | Inspectors tab (`inspector_slug` = "Inspector_1"…"_6") | Fine, but failures surface only at deploy time as "N skipped" |
| 3. Deploy | Schedule tab → "Deploy latest schedule" | Replaces the whole current week **including any manual edits, with no warning**; result is a one-line toast |
| 4. Review | Scroll through map (460px fixed) + 5-column board | Board shows all 5 days × up to 6 inspectors × 3 visits at once (~90 cards worst case); day filter affects only the map |
| 5. Adjust | "Adjust this week's schedule" table (placed *above* the map) | Full table of every assignment always visible; adding a visit requires **typing a raw project key from memory** |
| 6. Capacity sanity | Nowhere | The 3/day and 12/week caps live only in the solver; manual edits can silently violate them |

### 2.2 What exists to build on

- `GET /api/v1/latest-schedule` returns rows + the summary JSON (already consumed by `deployLatestSchedule`, summary discarded).
- The deploy action's slug/project-key mapping and skip-counting are solid — keep unchanged.
- The immediate-commit edit pattern (`updateAssignment`/`removeAssignment`/`addAssignment` server actions) is proven — keep the actions, change the surface.
- `DayFilter` (URL-param segmented control), `INSPECTOR_COLORS`, `currentWeekMonday()`, and the map's per-inspector popups all carry over.
- Solver runtime is bounded: CBC `timeLimit=25s`, but a full run includes tabular + **LSTM scoring first**, so end-to-end is minutes, not seconds — the UI trigger must be async.
- Layout system: the Overview's `lg:h-[calc(100dvh-7.25rem)]` + `minmax(0,1fr)` grid + `min-h` mobile fallbacks, already verified pixel-exact at 1366×768 and 1440×900.

---

## 3. Target UX Journey (to-be)

> **Persona:** the PPDO planning officer, Monday morning, 15 minutes to publish this week's deployment.

1. **Land** on Schedule → top strip shows the week ("Week of Sep 8"), a status line ("Last optimized 2h ago · Deployed Mon 08:14"), and the optimizer scorecard (5 chips). One glance answers "is there a plan, and is it any good?"
2. **Optimize** (if stale/empty) → click **Run optimizer** → button shows progress ("Scoring projects… Solving…"), page updates when done. No terminal.
3. **Review** → the workspace shows **one day at a time** (default: today, else Mon): left pane the routing map for that day, right pane that day's agenda grouped by inspector with capacity chips ("2/3 visits"). The week strip above shows Mon–Fri as compact tabs with visit counts and risk dots, so switching days is one click and the whole week stays scannable without rendering ~90 cards.
4. **Adjust** → click any agenda row (or map pin popup) → a small popover: reassign inspector, move day, remove. **Add visit** opens a dialog with a searchable project picker (name/municipality/risk shown; no raw keys). Capacity chips update live; an over-capacity assignment warns inline.
5. **Deploy** → if manual edits exist for the week, the confirm dialog says exactly what will be replaced ("Replaces 41 assignments including 3 manual edits"). Success shows the deployed count and skip reasons, as today.
6. **Done** — inspectors see their day on `/inspector`, unchanged.

## 4. Single-Screen Layout

```
┌───────────────────────────────────────────────────────────────────────┐
│ TOP STRIP (shrink-0, ~90px)                                           │
│ Week of Sep 8 · Last optimized… · Deployed…    [Run optimizer][Deploy]│
│ Scorecard chips: Solver Optimal · 42/150 scheduled · 28% coverage ·   │
│                  17 Critical covered · 4 clusters                     │
├───────────────────────────────────────────────────────────────────────┤
│ DAY STRIP (shrink-0, ~48px): [All][Mon 9][Tue 8][Wed 11][Thu 7][Fri 6]│
│   — each tab: visit count + tiny risk-tier dots; drives BOTH panes    │
├───────────────────────────────┬───────────────────────────────────────┤
│ ROUTING MAP (flex-1, min-h-0) │ DAY AGENDA (flex-1, own overflow-y)   │
│ h-full Leaflet, pins colored  │ per-inspector groups w/ capacity chip │
│ per inspector, legend overlay │  ● Cruz  2/3   [+ Add visit]          │
│ inside the map corner         │    Flood Control — Leon   [Critical]  │
│                               │    Slope Prot. — Alimodian [High]     │
│                               │  ● Reyes 3/3 ⚠ full                   │
│                               │    … (click row → edit popover)       │
└───────────────────────────────┴───────────────────────────────────────┘
```

- Root: `flex flex-col gap-3 lg:h-[calc(100dvh-7.25rem)] lg:min-h-135 lg:overflow-hidden`; below `lg` everything stacks and scrolls (same doctrine as the Overview).
- **"All" day view**: the map shows the whole week (as today); the agenda pane switches to a compact per-day × per-inspector count matrix (numbers + risk dots only, no project cards) — the overview replacement for the old 5-column board. Clicking a cell jumps to that day.
- The agenda pane is the **one** permitted internal scroll region (worst case 6 inspectors × 3 visits = 18 rows/day; fits ~650px without scrolling in practice, but the region guards against it). The page itself never scrolls.
- **Deleted outright:** the "Adjust this week's schedule" card/table (replaced by row popovers + Add dialog), the standalone board section, the below-map legend row (moves into a map-corner overlay), and the CLI-instruction empty state (replaced by a "Run optimizer" CTA card).

## 5. Workflow / Backend Work

### 5.1 `POST /api/v1/run-optimizer` (ml-service/main.py)
- Guarded by the existing `X-Webhook-Secret` check (`_check_webhook_secret`), like `update-monitoring`.
- Returns `202` immediately and runs `optimization_engine.run()` in a background task (the service already has the `_run_rescore` background pattern to copy). Writes a small `artifacts/optimizer_run_status.json` (`state: idle|running|done|failed`, `started_at`, `finished_at`, `error`).
- `GET /api/v1/optimizer-status` serves that file; `latest-schedule` gains a `generated_at` (CSV mtime) so the UI can say "Last optimized 2h ago".
- Concurrency guard: refuse a new run while one is `running`.

### 5.2 Frontend actions
- `actions/run-optimizer.ts`: server action → POST with the secret (`ML_SERVICE_WEBHOOK_SECRET` is already in `frontend/.env.local`) → then the client polls a lightweight status action every ~5s while pending. No secret ever reaches the browser.
- `actions/deploy-schedule.ts`: keep mapping logic; add a pre-check that counts existing current-week rows (and how many differ from the incoming CSV) and return it for the confirm dialog; keep replace-week semantics after confirmation.
- `actions/schedule.ts`: `addAssignment` gains a capacity check (warn-and-confirm at >3/day or >12/week for that inspector — warn, don't hard-block: the caps are solver assumptions, not laws); new `searchProjects(q)` action for the picker (name/municipality ilike, returns key + name + municipality + risk tier, limit ~20, ongoing first).

### 5.3 Explicit week handling
- Show `week_of` prominently; deploy remains "current week" (matching `currentWeekMonday()`), but the label makes the semantics visible. A "deploy to next week" toggle is a cheap follow-up if the adviser wants it — listed as stretch, not core.

## 6. Component Plan

| File | Change |
|---|---|
| `schedule/page.tsx` | Rewrite: viewport grid, one query (unchanged select), day param drives both panes; compute per-day counts + risk dots server-side |
| `schedule/schedule-workspace.tsx` (new, client) | Owns selected-assignment state; hosts map pane + agenda pane side by side |
| `schedule/day-strip.tsx` (new) | Replaces `day-filter.tsx`; tabs with counts + risk dots (URL param preserved) |
| `schedule/scorecard.tsx` (new) | Renders the summary chips from `latest-schedule` (fetched server-side; render "—" chips when the ML service is unreachable — the page must not break without it) |
| `schedule/agenda-pane.tsx` (new, client) | Per-inspector groups, capacity chips, row → edit popover (radix popover, immediate-commit via existing actions) |
| `schedule/add-visit-dialog.tsx` (new, client) | Searchable picker on `searchProjects`; replaces the raw-key input |
| `schedule/week-matrix.tsx` (new) | The "All" compact count matrix |
| `schedule/run-optimizer-button.tsx` (new, client) | Trigger + poll + progress states |
| `schedule/schedule-map.tsx` | Height `100%` of its pane instead of fixed 460px; legend moves to an in-map overlay; add a `ResizeObserver` → `map.invalidateSize()` (Leaflet does not notice flexbox resizes on its own) |
| Deleted | `schedule-editor.tsx`, `day-filter.tsx`, `schedule-board.tsx` (its per-day grouping logic moves into `week-matrix`/`agenda-pane`) |
| `schedule/loading.tsx` | Mirror the new grid exactly (same `calc` height) |

## 7. Implementation Phases (branch `feat/schedule-workspace`, atomic commits)

| # | Commit | Content | Risk |
|---|---|---|---|
| 1 | `feat(schedule): single-viewport workspace layout (read-only)` | Page rewrite: top strip + day strip + map/agenda panes + week matrix; board/editor cards removed; map fills pane; scorecard rendered from existing endpoint; loading.tsx | Low — no data-shape changes |
| 2 | `feat(schedule): inline assignment editing and searchable add` | Popover editing, add-visit dialog, `searchProjects` action, capacity chips + warn-on-over | Medium |
| 3 | `feat(ml-service): run-optimizer endpoint with status polling` | 5.1 backend + run button + status line | Medium — background task + status file |
| 4 | `feat(schedule): deploy confirmation with manual-edit warning` | Pre-check + confirm dialog | Low |
| 5 | Stretch (only if time allows): next-week deploy toggle; drag-and-drop between agenda groups | — | High, defer |

Push after phases 1 and 3 (coherent milestones). Each phase: `tsc`, `npm run build`, authenticated full-page screenshots at 1366×768 and 1440×900 asserting image height == viewport height (the technique proven on the Overview), plus a row-count cross-check of the agenda against `inspector_schedules` for the current week.

## 8. Information-Overload Budget (what the eye meets, before → after)

- Landing surface: ~90 board cards + 40-row edit table + map → **one day's ≤18 agenda rows + 5 chips + day tabs**.
- Editing affordances visible at rest: 3 selects + button × every row → **zero** (revealed on click).
- Optimizer insight visible: none → 5 chips + freshness line.
- Page height at 1366×768: ~4 viewports → **exactly 1**.

## 9. Risks & Gotchas (read before coding)

- **This repo's Next.js is patched** (`frontend/AGENTS.md`): check `node_modules/next/dist/docs/`; JSX text nodes containing HTML entities fuse boundary whitespace — compose captions as plain strings (the Overview convention).
- **Leaflet in a flex cell**: react-leaflet's container must have a resolved height (`h-full` chain with `min-h-0` ancestors) and needs `invalidateSize()` on pane resize; test the lg breakpoint boundary both ways.
- **Server/client boundary**: no function props into client components; the popover commits via imported server actions (existing pattern).
- **Deploy vs manual edits**: the replace-week delete is currently unconditional — the confirm dialog must land in the same phase as any encouragement to hand-edit more (phase 2 encourages edits; phase 4 protects them; acceptable ordering, but do not ship phase 2 to the adviser demo without mentioning it).
- **ML service offline** is the common case on the deployed Vercel frontend — every ML-service-backed element (scorecard, run button, freshness) must degrade to an inert state with a plain explanation, never an error boundary.
- **Recharts-style tick thinning has no equivalent here, but text density does**: agenda rows are one line each (project · municipality · tier badge); resist adding more fields — the popover holds the rest.
- **RLS**: `inspector_schedules` writes go through manager-only policies already; `searchProjects` reads `projects` as the signed-in manager — no new policies needed.
