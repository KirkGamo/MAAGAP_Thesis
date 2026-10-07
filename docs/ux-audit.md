# MAAGAP — UX Audit of the Schedule, Inspectors, Models and Reports tabs

_Phase 0, 2026-10-06. Read-only. No code changed. Written against the running app and the component source, not against file listings — the last plan in this repo was written from greps and was wrong about three of its five workstreams (`WEBSITE_REDESIGN_PLAN.md` §0)._

---

## 1. Stack

| | |
|---|---|
| Framework | Next.js 16, App Router, React Server Components; pages are `async` server components reading Supabase directly |
| Styling | Tailwind v4, CSS-native `@theme` in `globals.css`. **No `tailwind.config.ts`** |
| UI primitives | local `components/ui/`: `badge`, `button`, `card`, `input`, `label`, `sheet`, `skeleton`, `table`, `tabs` (shadcn-style). Plus `components/tremor/` and `components/error-panel.tsx` |
| Charts | Tremor; Leaflet + react-leaflet(-cluster) for maps |
| State | **URL search params**, read server-side from `searchParams`. No client store |
| Tests | Vitest is installed (`npm test`) |

---

## 2. The constraint the brief does not know about

Four of these five tabs are bound by a **single-viewport contract**: at 1366×768 the full-page height must equal the viewport height, with no scrolling. It is not a preference. It is the stated objective of three separate committed plans (`SCHEDULE_WORKFLOW_IMPROVEMENT_PLAN.md` §1.2, `INSPECTORS_TAB_IMPROVEMENT_PLAN.md` §1.3, `REPORTING_LOOP_IMPROVEMENT_PLAN.md` §1.4), each verified by screenshot height, and it is re-verified after every token change.

Measured today:

| Tab | scrollHeight @1366×768 | | Has a committed plan? |
|---|---|---|---|
| Overview | 768 | in contract | `DASHBOARD_UI_IMPROVEMENT_PLAN.md` |
| Schedule | 768 | in contract | `SCHEDULE_WORKFLOW_IMPROVEMENT_PLAN.md` |
| Inspectors | 768 | in contract | `INSPECTORS_TAB_IMPROVEMENT_PLAN.md` |
| Reports | 768 | in contract | `REPORTING_LOOP_IMPROVEMENT_PLAN.md` |
| **Models** | **1907 (2.48 screens)** | **scrolls** | **none** |

This single table reorders the whole brief. Three of the four pages it targets were rebuilt in September specifically to achieve what it asks for — progressive disclosure, a primary action, URL-synced state, reduced information load — and the one page it treats as an equal peer is the only one that was never designed at all.

The brief's global requirements (3–4 KPI cards above the fold, **plus** a toolbar row, **plus** a view switcher, **plus** tabs, **plus** a stepper) cannot coexist with a 768px budget. Applied literally to Schedule, Inspectors or Reports, they do not improve those pages; they revert them.

---

## 3. Per-page findings

### 3.1 Schedule — already implements most of the brief

**On screen at load:** title + week/deploy status; two primary actions top-right (Run optimizer, Deploy latest schedule); a coverage warning; day tabs carrying per-day counts; then a two-pane body — routing map left, one day's agenda right.

What the brief asks for and **already exists**: URL-synced view state (`?day=`), progressive disclosure (one day by default, `All` swaps in a week count matrix), a single-day detail surface that preserves list context, inline edit on click (reassign / move / remove), a deploy confirmation stating consequence, capacity chips against the solver's 3/day and 12/week assumptions.

Deliberately absent, with reasons on record: drag-and-drop (explicit non-goal), multi-week planning (explicit non-goal). `schedule-board.tsx`, `day-filter.tsx` and `schedule-editor.tsx` were **deleted** in that rebuild — the brief's "Calendar / Timeline / List switcher" would reintroduce the five-column board that rebuild removed.

**Genuine gaps:**

1. **No retry affordance when the ML service is unreachable.** The page degrades correctly (renders from Supabase alone) and says *"Optimizer output unavailable — ML service not reachable"*, but offers no way to retry and no indication of what the manager should do. This is the brief's "error state with retry", and it is legitimate.
2. **Conflicts are not surfaced as a filter.** Capacity overload is visible per-inspector as chips, but there is no "show me only the problems" affordance.

### 3.2 Inspectors — one real bug, and the brief asks for data that does not exist

**On screen at load:** readiness headline; chips; slot cards showing holder, weekday load strip, active state; an unrostered-people panel; a "How slots work" explainer.

> **Finding INS-1 (high severity, visible in the supplied screenshot).**
> When the ML service is offline, the readiness headline reads
> **"1 of 1 optimizer slot filled — every slot can receive deployed work."**
> The recorded true state is **1 of 6 slots filled, 21 of the latest solve's 25 visits undeployable.**
>
> Cause: `page.tsx` builds slot rows from `solverRoster?.slots ?? []`. When `fetchSolverRoster()` returns null, the slot universe collapses to *only those slots some profile already holds* — so filled always equals total, `emptySlots` is 0, and `composeHeadline()` falls through to its most reassuring branch.
>
> The page therefore issues its strongest all-clear at precisely the moment it has the least information. The muted grey chip *"Optimizer roster unavailable — ML service offline"* is present but directly contradicts the bold headline above it, and nothing prompts a reader to prefer the chip.
>
> This is the one defect in this audit that can cause a wrong operational decision: a manager who sees "every slot can receive deployed work" has no reason to visit the Schedule tab's deploy step, which is where the truth currently surfaces. It is also exactly what the September plan built this tab to prevent (§1.1: *"The manager only discovers this at the Schedule tab's deploy step"*).

**Where the brief asks for data that does not exist.** It specifies a master-detail layout with tabs for *contact, specialization, region, availability*, and a *capacity chart over time*. `INSPECTORS_TAB_IMPROVEMENT_PLAN.md` §1 lists per-inspector capacity fields and contact details as **explicit non-goals**, because `profiles` has no such columns and there is no source of truth for them anywhere in the pipeline. Building those tabs means inventing the data or adding backend the brief forbids changing.

The brief also assumes inspectors are the primary object. They are not — **slots** are, deliberately. The optimizer allocates to numbered slots; an unheld slot silently drops its share of every solve. That inversion is the tab's entire reason for existing.

### 3.3 Models — the real opportunity, and the one genuinely risky request

**On screen at load:** seven stacked full-width metric blocks over 2.48 screens — three-learner meta-learner, two-learner meta-learner, which model scored the live population, Random Forest, XGBoost, LSTM, delay-magnitude regression — plus two long caveat callouts.

Every usability complaint the brief makes is true *here*: no hierarchy, everything competing, nothing disclosed progressively, dense statistical language for an audience that includes non-ML government stakeholders. It has no plan and no viewport contract, so there is room to restructure.

**But one specific request is actively harmful.** The brief asks for *"compare 2 models side by side via checkbox selection"*. This page already carries, in a callout:

> *"These two models are evaluated on different populations, so their metrics must not be compared directly."*

The three-learner is measured on 598 sequence-bearing rows; the two-learner on all 1,765. `D23-Keep-The-LSTM.md` records that the naive comparison is **confounded and must never be reported as it stands**, and that the valid paired comparison on identical rows gives McNemar **p = 0.189**. A generic side-by-side compare UI would present 88.8% against 92.6% as a like-for-like verdict — manufacturing the exact invalid inference the page was built to prevent, in the system's most panel-sensitive screen.

The brief's *registry* framing (versions, status active/training/archived, set-active, retrain, recent predictions, configuration, raw logs) describes an MLOps platform. This app has one training run's artifacts. There is no model versioning, no registry table, no retrain-from-UI endpoint, and adding them is backend work the brief rules out.

### 3.4 Reports — the brief describes a different product

**On screen at load:** a master-detail audit trail. Left, a list of **inspector field monitoring reports** (project, date, inspector, municipality, observed status). Right, the selected report — observed status vs. current project status, re-score state, photos, "Open PPA". Filters: project-name search, inspector. URL params `?q=`, `?inspector=`, `?report=`.

The brief specifies a **report generator**: templates, parameter forms, presets ("This month", "Last quarter"), live preview, PDF/CSV export, saved-report history with author and re-run, and a sticky table of contents for long reports.

None of that exists, and not by omission. Searching `app/manager/reports/` for export, generate, template, preset, PDF, CSV and download returns **zero** matches. "Reports" here means *reports filed by inspectors*, not *reports generated for stakeholders*. Implementing §4 of the brief is building a new feature — a substantial one, requiring export infrastructure — not restructuring a page.

The page was rebuilt in September specifically to be a single-viewport master-detail that signs one report's photos per render instead of up to 200.

**Genuine gaps:** the list is not sortable, and there is no empty-state guidance when a filter matches nothing.

---

## 4. What I propose

Ordered by value, not by the brief's order.

### A. Fix INS-1 first — the offline readiness inversion

Separate *"no empty slots"* from *"we cannot see the roster"*. When `fetchSolverRoster()` returns null, the headline must not claim completeness; it should state that the roster size is unknown and name the last-known figure if one is cached. Small, contained, and the only change here that prevents a wrong decision rather than improving a layout.

### B. Restructure Models — the brief's principles, minus the registry

The one page with both room and need.

- Lead with the **deployed** reality: which model actually scored the live population, and the headline accuracy with its population stated. That is the question a stakeholder has.
- Demote the four Level 0 learners and the regression behind disclosure — they are supporting evidence, not the headline.
- Keep both meta-learners visible **with their populations and the non-comparability callout intact**, and present the *paired* result (McNemar p = 0.189) as the comparison, since it is the only valid one.
- Add plain-language help for AUC-ROC, precision/recall and MAE, for the non-ML audience the brief correctly identifies.
- Target one screen at 1366×768, matching the other four tabs.

**Declining:** registry, versioning, set-active, retrain, recent-predictions and configuration tabs (no data, backend changes forbidden), and checkbox compare (manufactures a confounded comparison).

### C. Schedule — add the error state, decline the view switcher

Add retry on ML-unreachable, and a conflicts quick-filter. Decline Calendar/Timeline/List: day-vs-week disclosure already exists and is URL-synced, and a third view reinstates the deleted board and breaks the contract.

### D. Reports — sorting and empty states, decline the generator

Add column sort and a real empty state. The Generate/History restructure is a new feature; if you want a stakeholder-facing report generator, it should be scoped as its own piece of work with export infrastructure, not smuggled in as a layout pass.

### E. Shared primitives — only as a no-op refactor

The pages are already decomposed (`agenda-pane`, `week-matrix`, `day-strip`, `slot-card`, `roster-readiness`, `report-list`, `report-detail`, `reports-filters`). A `PageHeader`/`PageToolbar` extraction is defensible as a pure refactor that changes no rendered output, verified by the contract check. `DetailDrawer`/`MasterDetailLayout` are not needed: `sheet.tsx` exists and master-detail is already built twice.

---

## 5. Conflicts — resolved 2026-10-08

All five were put to the project owner individually, with the evidence and the cost of each option. Rulings:

| # | Conflict | Decision |
|---|---|---|
| 1 | Single-viewport contract vs. the brief's page anatomy | **Contract wins.** Schedule, Inspectors and Reports stay pinned to one screen at 1366×768. The brief's header/KPI/toolbar anatomy applies to Models only, which has the room |
| 2 | Reports: audit trail vs. document generator | **Generator out of scope.** Reports remains the inspector-submission audit trail; it gains sortable columns and a real empty state |
| 3 | Models side-by-side comparison | **Paired comparison instead.** The same-598-rows result and McNemar p = 0.189 get surfaced; the non-comparability callout stays. The confounded side-by-side is not built |
| 4 | Inspector contact / specialization / region / capacity | **Left out.** No source of truth exists and the September plan records them as non-goals. Slots remain the page's primary object. The brief's clickable summary-stat filters are adopted |
| 5 | Full refactor vs. targeted changes | **Targeted.** The three September rebuilds stand. Models gets the real restructure. `PageHeader`/`PageToolbar` are extracted as a no-op refactor for future consistency |

The reasoning behind each is in §2–§3 above; the short version is that the brief was written without sight of this repo's committed plans, its data model, or `D23`, and three of its four pages had already been rebuilt to achieve what it asks for.

## 6. Gaps this audit could not settle

- **Keyboard and focus behaviour** was not tested. The brief's accessibility requirements (focus trap, Esc-to-close, visible focus rings, tab order) are reasonable everywhere and I have not verified the current state.
- **1024px** was not measured; today's sweep covered 1868/1493/1366/1280/390.
- The ML service was offline during this audit, which is how the screenshots were produced. Schedule and Inspectors were therefore observed only in their degraded state — which is how INS-1 surfaced, but it means I have not seen either page with live solver data.
