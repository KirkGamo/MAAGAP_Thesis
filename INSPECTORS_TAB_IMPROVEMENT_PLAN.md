# MAAGAP — Inspectors Tab Improvement Plan

_Drafted 2026-09-08. Scope: the Manager Inspectors tab (`frontend/src/app/manager/inspectors/`), its server actions (`actions/inspectors.ts`), and one optional Supabase trigger migration. Third in the series after `DASHBOARD_UI_IMPROVEMENT_PLAN.md` and `SCHEDULE_WORKFLOW_IMPROVEMENT_PLAN.md`; reuses the same single-viewport layout system and the same progressive-disclosure doctrine._

---

## 1. Objectives

1. **Make this tab report the readiness of the whole prescriptive pipeline.** It is the bottleneck, and it currently says nothing about being one. Live state today: the optimizer solves for **6 inspector slots**, exactly **1 profile exists** (Test Inspector → `Inspector_1`), and the most recent solve therefore deploys **4 of 25 rows**. The manager only discovers this at the Schedule tab's deploy step. The roster is where it should be visible and fixable.
2. **Show each inspector as a person with a workload,** not a row with a name and a text box. Who is carrying this week's visits, on which days, against the solver's own 3/day and 12/week assumptions.
3. **One screen, no scrolling** at 1366×768 and up, verified the same way as the Overview and Schedule pages (full-page screenshot height must equal viewport height).
4. **Minimize information overload / editing noise.** Today every row renders a free-text slug input plus a Save button at rest — the same always-on editing surface the Schedule tab just removed. Editing should be revealed on demand.

**Non-goals:** per-inspector capacity fields (deliberately excluded — `profiles` has no such column and there is no source of truth for it anywhere in the pipeline; see `inspectors/page.tsx`'s existing scope note, which this plan preserves); contact details; changing `optimization_engine.py`'s roster size or the invite mechanism.

---

## 2. Current State

### 2.1 What the tab is today

A heading, an "Add inspector" invite form, an explanatory paragraph about optimization slots, and one table: **Name · Joined · Optimization slot · Status**. Slot is a free-text `<input>` + Save on every row; Status is a click-to-toggle Active/Inactive pill.

### 2.2 Verified live data (2026-09-08, read-only survey)

| Fact | Value | Consequence |
|---|---|---|
| Inspector profiles | **1** (Test Inspector) | 5 of the solver's 6 slots have nobody |
| With optimization slot | 1 (`Inspector_1`) | — |
| Active | 1 | — |
| `monitoring_reports` rows | **0** | Any "recent activity" panel would be permanently empty — do not build one |
| `inspector_schedules` rows | 6, across weeks 2026-07-27 / 09-06 / 09-07 | Current week (09-07) holds 4 |
| Latest solve | 25 rows, `inspectors_used` = `Inspector_1..6` | 21 rows undeployable for want of people |

### 2.3 Journey pain (as-is)

| Step | Where | Pain |
|---|---|---|
| Know the team is incomplete | nowhere | The gap is invisible until Deploy reports "21 skipped" |
| Add an inspector | Invite form | Fine, but the new person arrives with **no slot**, and nothing prompts you to give them one |
| Assign a slot | Free-text box per row | Typos are the expected error (the action already special-cases the unique violation); no list of what the valid slots even are |
| Judge workload | nowhere | No indication who is loaded or idle this week |
| Deactivate | Status pill | Instant, no warning — even if that person holds this week's visits |

### 2.4 What carries over

`actions/inspectors.ts` (all three actions, including the service-role invite path and the 23505 handling) is sound and stays. The `capacity.ts` constants, the `Card`/`Badge` primitives, the `Sheet` slide-over, the single-viewport grid recipe, and the screenshot-equals-viewport verification technique all come straight from the Schedule work.

---

## 3. Target UX Journey

> **Persona:** the PPDO planning officer, standing up the field team before the first real deployment week.

1. **Land** → the first line answers the only question that matters: *"1 of 6 optimizer slots filled — 21 of this week's 25 optimized visits cannot be deployed."* Readiness chips give the supporting counts.
2. **See the roster as slots** → a grid of the solver's actual slots. A filled slot shows the person, their week load (`4 visits · Mon 1, Wed 1, Thu 1, Fri 1`), and status. An empty slot shows **how many visits are waiting for it in the current solve** (`Inspector_3 · 5 visits waiting`) so the manager knows which gap costs the most.
3. **Fill a gap** → from an empty slot: *Assign existing* (pick an unslotted inspector) or *Invite* (opens the invite panel with that slot pre-selected).
4. **Adjust** → click a person to reveal reassign-slot / activate / deactivate. Deactivating someone who holds visits this week warns first, saying how many.
5. **Everyone else** → a compact table below for inspectors with no slot and for inactive accounts, so the slot grid stays bounded and scannable.

## 4. Single-Screen Layout

```
┌──────────────────────────────────────────────────────────────────────┐
│ Inspectors                                        [Add inspector]     │
│ 1 of 6 optimizer slots filled — 21 of 25 optimized visits undeployable│
│ chips: 1 active · 5 slots empty · 4 visits scheduled this week        │
├──────────────────────────────────────────────────────────────────────┤
│ OPTIMIZER SLOTS  (grid, 2–3 cols, flex-1, min-h-0)                   │
│ ┌───────────────┐ ┌───────────────┐ ┌───────────────┐               │
│ │ Inspector_1   │ │ Inspector_2   │ │ Inspector_3   │               │
│ │ Test Inspector│ │ — unassigned  │ │ — unassigned  │               │
│ │ 4 visits/wk   │ │ 5 waiting     │ │ 3 waiting     │               │
│ │ M1 T· W1 T1 F1│ │ [Assign][Invite]│ │[Assign][Invite]│             │
│ │ ● Active      │ │               │ │               │               │
│ └───────────────┘ └───────────────┘ └───────────────┘   … 4,5,6      │
├──────────────────────────────────────────────────────────────────────┤
│ NOT IN THE ROSTER (compact table, own overflow-y, shrink-0 max-h)     │
│ Name · Joined · Status · [Assign to slot ▾]                          │
│ Capacity note: solver assumes 3 visits/day, 12/week per inspector     │
└──────────────────────────────────────────────────────────────────────┘
```

- Root: `flex flex-col gap-3 lg:h-[calc(100dvh-7.25rem)] lg:min-h-135 lg:overflow-hidden` — identical to the Overview and Schedule pages, so the three tabs share one layout contract. Below `lg` it stacks and scrolls normally.
- The slot grid takes the flexible row (`flex-1 min-h-0`); with 6 slots at 3 columns it is two rows and never needs to scroll. The bottom table is the single permitted internal scroll region, bounded by `max-h`.
- Where the slot list comes from: **the ML service's `latest-schedule` summary** (`inspectors_used`, plus per-slot row counts from the CSV rows) — *not* a hardcoded `1..6`. That honors the explicit decision recorded in `slug-field.tsx` (don't duplicate the roster size in Python and TypeScript). When the service is unreachable, fall back to the distinct slugs already present on `profiles`, and the grid degrades to "slots in use" with a muted note.

## 5. Component & Action Work

| File | Change |
|---|---|
| `inspectors/page.tsx` | Rewrite: viewport grid; one Supabase read for profiles + one for the current week's `inspector_schedules`; best-effort `latest-schedule` fetch (3s timeout, null on failure — the page must render fully from Supabase alone) |
| `inspectors/roster-readiness.tsx` (new) | The headline sentence + chips |
| `inspectors/slot-card.tsx` (new, client) | Filled/empty slot card; hosts the reveal-on-click actions |
| `inspectors/assign-slot-menu.tsx` (new, client) | Slot picker built from the discovered slot list, with a free-text escape hatch when the service is offline; replaces the always-visible input+Save |
| `inspectors/unrostered-table.tsx` (new) | Unslotted + inactive accounts |
| `inspectors/invite-inspector-form.tsx` | Move into a `Sheet` slide-over (matching Add-visit), accept an optional pre-selected slot |
| `inspectors/active-toggle.tsx` | Add the warn-when-scheduled confirmation; keep the commit-on-change pattern |
| `actions/inspectors.ts` | `toggleInspectorActive` unchanged; `setInspectorSlug` unchanged; **new** `assignSlotToProfile` is unnecessary (reuse `setInspectorSlug`); extend `inviteInspector` with an optional slot passed through the invite's `data` metadata (see phase 4) |
| `inspectors/loading.tsx` | Mirror the new grid at the same `calc` height |

## 6. Implementation Phases (branch `feat/inspectors-roster`, atomic commits)

| # | Commit | Content | Risk |
|---|---|---|---|
| 1 | `feat(inspectors): single-viewport roster readiness layout` | Page rewrite, readiness headline + chips, slot grid (read-only), unrostered table, loading skeleton. No behavior change. | Low |
| 2 | `feat(inspectors): show per-slot workload and waiting visits` | Week workload per filled slot from `inspector_schedules`; "N visits waiting" per empty slot from the latest solve; global capacity note | Low |
| 3 | `feat(inspectors): reveal-on-click slot assignment and invite-into-slot` | Slot picker (service-derived list + free-text fallback), invite moved into a Sheet with optional pre-selected slot, editing affordances removed from rest state | Medium |
| 4 | `feat(inspectors): warn before deactivating a scheduled inspector` | Confirmation naming this week's visit count | Low |
| 5 | *Optional, needs a manual migration:* `feat(db): carry inspector_slug through the invite` | Extend `handle_new_user()` to read `raw_user_meta_data ->> 'inspector_slug'`, shipped as a loose `add_profiles_slug_from_invite.sql` next to the existing `add_*.sql` files, so an invited person lands already bound to their slot | Medium — DB trigger; must be run by hand in the Supabase SQL editor, like every other migration here |

Push after phase 2 and phase 4. Each phase: `tsc`, `npm run build`, `npm run lint` (no new findings in touched files), and authenticated full-page screenshots at 1366×768 and 1440×900 asserting image height equals viewport height — plus a cross-check that the rendered slot/person counts match a direct Supabase query.

## 7. Information-Overload Budget (before → after)

- Editing affordances visible at rest: a text input + Save button **per row** → **zero** (revealed on click).
- Pipeline-readiness information: **none** → one headline sentence + 3 chips.
- Workload information: **none** → per-slot week load and per-empty-slot waiting count.
- Explanatory prose about slots: a 4-line paragraph nobody re-reads → a short chip plus contextual copy on the empty slots themselves, where the action is.
- Page height at 1366×768: currently ~1 screen already, but unbounded as inspectors are added → **exactly 1**, with growth absorbed by the bottom table's own scroll region.

## 8. Risks & Gotchas (read before coding)

- **This repo's Next.js is patched** (`frontend/AGENTS.md`): read `node_modules/next/dist/docs/` first; JSX text nodes containing HTML entities fuse boundary whitespace — compose captions as plain strings, the convention now used on both rebuilt pages.
- **The ML service is usually offline** for a deployed frontend. Every service-derived element (slot list, waiting counts) must degrade to a muted fallback; the roster itself must render from Supabase alone. Same stance as the Schedule scorecard.
- **Do not hardcode `Inspector_1..6`** anywhere in TypeScript — that is an explicitly recorded decision (`slug-field.tsx`), and `INSPECTOR_COUNT` can change in `optimization_engine.py`.
- **Do not invent per-inspector capacity.** The 3/day, 12/week figures are global solver assumptions (mirrored in `manager/schedule/capacity.ts`); display them as context, never as an editable per-person field.
- **`monitoring_reports` is empty (0 rows).** Any activity display must be a single line that reads honestly when there is nothing, not a panel.
- **The invite path needs the service-role client** (`auth.admin.inviteUserByEmail` ignores RLS) — unchanged, but don't accidentally route it through the RLS client when moving the form into a Sheet.
- **Phase 5 changes a trigger** that runs on every new auth user, managers included. `handle_new_user()` must keep its current behavior exactly when the metadata key is absent, and the migration must be run as its own execution in the SQL editor (the repo's standing migration convention).
- **Deactivation does not unassign.** The warning must say that plainly rather than implying it cleans up; unassigning is the Schedule tab's job.
