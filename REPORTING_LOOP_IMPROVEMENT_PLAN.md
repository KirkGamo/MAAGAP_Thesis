# MAAGAP — Project Reporting Loop Improvement Plan

_Drafted 2026-09-08. Scope: the full field-reporting feedback loop — inspector capture (`frontend/src/app/inspector/`), the submission action (`actions/submit-report.ts`), the ML rescore path (`ml-service/main.py`, `inference/live_scoring.py`), and the manager-facing audit trail (`app/manager/reports/`). Fourth in the series after the dashboard, schedule, and inspectors plans; reuses the same single-viewport layout contract and progressive-disclosure doctrine._

---

## 1. Objectives

1. **Make the loop actually close.** It is broken today, silently — verified, not inferred (see §2.2). An inspector's report is saved, but the project it describes is never updated, and nothing anywhere reports the failure.
2. **Make the rescore observable and recoverable.** The webhook to the ML service is fire-and-forget with a 3-second timeout and no persisted outcome. When the service is down — its normal state — the risk tier silently never refreshes, and no one can tell which reports were absorbed and which evaporated. `submit-report.ts`'s own docstring says a dropped webhook "should be retried by the ML service side… (a dead-letter queue or a periodic reconciliation job)"; neither exists.
3. **Fit the field, not the desk.** An inspector files from a phone at a job site, on a connection that drops. Today a failed submit loses the form, there is no way to confirm a report landed, and no way to file for a project that isn't on today's route despite the UI asking the question.
4. **One screen, no scrolling** on the manager Reports tab at 1366×768 and up, same contract as the three rebuilt tabs, and stop signing up to 200 photo URLs per page render.

**Non-goals:** retraining on incoming reports (explicitly rejected in `live_scoring.py` — a single observation cannot justify it, and the periodic batch retrain stays the mechanism); making `percent_complete`/`amount_spent` influence the score (the trained feature schema is frozen — see §8); a full notifications backend.

---

## 2. Current State

### 2.1 The loop as built

```
Inspector form ──▶ submitReport()
                     │
                     ├─▶ INSERT monitoring_reports        ✅ works (RLS: "inspectors insert own")
                     ├─▶ UPDATE projects.status/date      ❌ SILENT NO-OP (§2.2)
                     └─▶ POST /webhooks/monitoring-report  ⚠️ fire-and-forget, outcome never recorded
                              │
                              └─▶ live_scoring.score_project() ──▶ patches risk_tier via service role
```

### 2.2 Verified findings (2026-09-08)

| # | Finding | How it was established |
|---|---|---|
| 1 | **`projects` is never updated by a report.** `submitReport` runs as the *inspector*, and `projects` has only two policies: managers `FOR ALL`, inspectors `FOR SELECT`. The `UPDATE` matches zero rows and PostgREST returns **no error**, so the code's unchecked `await` looks like success. | Probed live as `inspector@maagap.test` with a no-op update against an assigned project: `rows affected: 0 | error: none`. |
| 2 | `monitoring_reports` holds **0 rows** | Read-only survey |
| 3 | Inspector `SELECT` on an assigned project *is* allowed, so the `project_key` lookup and the webhook still fire | Same probe |
| 4 | Reports tab signs photo URLs for **every** row (`MAX_ROWS = 200`) on every render | `manager/reports/page.tsx` |
| 5 | `amount_spent` is hardcoded `null` in the webhook payload — never collected, though the LSTM sequence has an amount channel | `submit-report.ts:209` |
| 6 | "Need to file a report for a project not on today's list?" is a card with **no action** | `inspector/page.tsx:99-105` |
| 7 | No inspector-side submission history, though RLS already permits it ("reports: inspectors read own") | No UI exists |
| 8 | `visited_at` defaults to `now()`; a report filed the morning after a visit is dated wrong with no way to correct it | `schema.sql:230` |

**Consequence of #1, in plain terms:** a project reported Completed in the field stays "On-going" on every manager screen forever. Worse, the webhook still reports the new status to the ML service, which patches `risk_tier` through the *service-role* client — so the risk tier can move while the status it was derived from does not. The two halves of the same event disagree, and the loop's most important step is the one that fails quietest.

### 2.3 Journey pain (as-is)

| Step | Actor | Pain |
|---|---|---|
| Reach the project | Inspector | Only via today's route; the "other project" affordance is a dead end |
| Fill the form | Inspector | Good (mobile-first, per-photo upload progress) — keep it |
| Submit on a weak signal | Inspector | No offline handling: a failure returns a raw error string and the typed remarks are still there, but a lost connection mid-submit gives no queue, no retry, no confirmation |
| Confirm it landed | Inspector | Impossible — redirected to `/inspector` with no record of what was filed |
| Project reflects reality | — | **Never happens** (§2.2 #1) |
| Risk refreshes | ML service | Only if it happened to be reachable within 3 seconds; outcome unrecorded either way |
| Manager reviews | Manager | A 7-column table that scrolls horizontally, no indication of which reports were absorbed by the model or changed anything |

### 2.4 What carries over

The capture form's mobile-first design and its private-bucket photo handling (paths stored, re-signed on view) are sound and stay. So do the RLS insert policy, the ML service's `_maybe_patch_supabase` service-role path, and — from the last three tabs — the `100dvh` layout contract, the `Sheet`/popover patterns, and screenshot-equals-viewport verification.

---

## 3. Target Journey

> **Inspector, at a site, one bar of signal.**

1. Opens `/inspector` → today's route, plus a working **"File for another project"** search over everything assigned to them this week.
2. Fills the form; optionally **backdates the visit** and records **amount spent**.
3. Submits. If the connection is down, the report is **queued on the device** and the screen says so plainly; it sends itself on reconnect.
4. Sees **"My recent reports"** with each entry's state — *filed*, *queued*, *rescored* — so "did that go through?" is answerable without calling the office.

> **Manager, next morning.**

5. Opens Reports → a loop-health strip: *filed this week · awaiting rescore · projects updated*.
6. Scans the list, selects one → detail pane with photos, what the project status changed **from → to**, and the rescore outcome.
7. Anything stuck shows **Retry rescore**, one click, no terminal.

## 4. Single-Screen Layout (manager Reports tab)

```
┌──────────────────────────────────────────────────────────────────────┐
│ Reports                       [search] [inspector ▾] [state ▾]       │
│ 0 filed this week · 0 awaiting rescore · 0 projects updated          │
├───────────────────────────────┬──────────────────────────────────────┤
│ REPORT LIST (flex-1, scrolls) │ SELECTED REPORT (flex-1, scrolls)    │
│ ▸ 08 Sep 09:14 · T. Inspector │  Flood Control — Leon   [Critical]   │
│   Flood Control, Leon         │  Status: On-going → Completed        │
│   Completed        ● rescored │  85% complete · ₱1.2M spent          │
│ ▸ 07 Sep 15:02 · …            │  "Slope work finished, drainage…"    │
│   …                  ● queued │  [photo] [photo] [photo]             │
│                               │  Rescore: done 41s after filing      │
│                               │  Risk: Critical → High               │
│                               │            [Open PPA] [Retry rescore]│
└───────────────────────────────┴──────────────────────────────────────┘
```

- Root: `flex flex-col gap-3 lg:h-[calc(100dvh-7.25rem)] lg:min-h-135 lg:overflow-hidden` — the contract now shared by Overview, Schedule, and Inspectors.
- Master-detail replaces the 7-column table, which forced horizontal scrolling because remarks and a photo strip cannot coexist with five other columns.
- **Photos are signed only for the selected report** — one storage round trip instead of up to 200 per render (§2.2 #4).
- List and detail each own their scroll; the page never scrolls.

## 5. Work Items

### 5.1 Close the loop (the §2.2 #1 fix)
- Move the `projects` mutation in `submitReport` to the **service-role client**, gated by an explicit authorization check: the signed-in user must be a manager, or an inspector with an `inspector_schedules` row for that project. Check and surface the result instead of ignoring it.
- **Rejected alternative:** granting inspectors `UPDATE` on `projects` via RLS. Postgres policies gate rows, not columns, so that would let a field device write `risk_tier`, `amount_php`, anything. Keeping the table manager-only and doing the narrow write server-side, in one audited place, matches how `inviteInspector` already handles a privileged action.
- Never clear an existing `date_of_completion`; set it only on the transition into `completed`. Record the previous status on the report so the audit trail shows from → to.

### 5.2 Make the rescore observable (needs a migration)
- `add_monitoring_reports_rescore_state.sql`: `rescore_state text default 'pending' check (…in ('pending','done','failed','skipped'))`, `rescored_at timestamptz`, `rescore_error text`. Loose `add_*.sql` beside the existing ones; **must be run by hand in the Supabase SQL editor**, this repo's standing migration convention.
- `submitReport` writes `pending`; the ML service marks `done`/`failed` from `_run_rescore` (it already holds a service-role client for `_maybe_patch_supabase`).
- New `retryRescore(reportId)` server action re-posts the webhook. This is the dead-letter mechanism the code's own docstring assumed existed.

### 5.3 Inspector-side field reality
- Working project picker for "file for another project", scoped to their assignments (RLS already limits what they can read).
- **My recent reports** list with per-report state.
- Backdate `visited_at` (defaulting to now, capped at not-in-the-future).
- Optional `amount_spent`, labeled honestly (§8).
- **Offline queue:** persist an unsent submission (IndexedDB) and flush on reconnect, with a visible queued state. Ship the detection + preserved state + manual retry first; automatic background sync is the stretch half.
- Idempotency key per submission so a double-tap on a flaky connection cannot file twice.

### 5.4 Manager Reports rebuild
Per §4, plus a `state` filter and the loop-health strip.

| File | Change |
|---|---|
| `actions/submit-report.ts` | Service-role project write + authorization check + error surfacing; set `rescore_state`; accept `visitedAt`, `amountSpent`, idempotency key |
| `actions/retry-rescore.ts` (new) | Re-post the webhook for one report |
| `inspector/page.tsx` | Working "another project" entry point; recent-reports list |
| `inspector/report/[projectId]/report-form.tsx` | Backdate, amount, offline queue, idempotency |
| `manager/reports/page.tsx` | Master-detail viewport layout; sign only the selected report's photos |
| `manager/reports/report-detail.tsx` (new) | Detail pane incl. status/risk transitions and Retry |
| `manager/reports/loading.tsx` | Mirror the new grid |
| `supabase/add_monitoring_reports_rescore_state.sql` (new) | §5.2 |

## 6. Phases (branch `feat/reporting-loop`, atomic commits)

| # | Commit | Risk |
|---|---|---|
| 1 | `fix(reports): apply project status changes from field reports` — §5.1, the silent no-op. Highest value, no schema change. | Medium (privileged write; needs the authorization check to be exactly right) |
| 2 | `feat(reports): single-viewport master-detail reports workspace` — §5.4, incl. the photo-signing fix | Low |
| 3 | `feat(reports): record and retry rescore outcomes` — §5.2 (migration + service + UI) | Medium — DB migration, run by hand |
| 4 | `feat(inspector): file for any assigned project, see recent submissions` — §5.3 first half | Low |
| 5 | `feat(inspector): backdated visits, amount spent, offline-tolerant submit` — §5.3 second half | Medium — offline queue |

Push after 1 and 3. Each phase: `tsc`, `npm run build`, `npm run lint` (no new findings in touched files), screenshots at 1366×768/1440×900 asserting height equals viewport, and — for phase 1 — an end-to-end run filing a real report and confirming the project row actually changes.

## 7. Information-Overload Budget (before → after)

- Manager landing surface: a 7-column × 200-row table with every remark and photo strip inline → a one-line-per-report list plus one detail pane.
- Horizontal scrolling on the Reports tab: present → none.
- Storage round trips per render: up to 200 → 1.
- Loop-health information: none → three counters plus a per-report state.
- Inspector's answer to "did it send?": none → an explicit state on their own list.

## 8. Risks & Gotchas (read before coding)

- **The privileged write is the whole risk of phase 1.** A service-role client bypasses RLS entirely, so the assignment check *is* the security boundary. Verify it denies an inspector writing to a project they were never assigned, and keep the write to exactly `status`/`date_of_completion`.
- **`percent_complete` and `amount_spent` cannot move a risk score** until they are added to `feature_engineering.py` Step 9 and the models are retrained — the trained feature schema is frozen (`live_scoring.py`'s scope note). Collect them as bookkeeping and label them that way in the UI; do not imply the score responded to them.
- **Status regression is legitimate.** A field observation may correct a wrong status downward. Record every transition rather than blocking it, but never wipe a `date_of_completion` that already exists.
- **The ML service is usually offline.** Every rescore-derived element degrades to "pending" with a Retry, never an error state — the stance already used by the Schedule scorecard and the Inspectors slot list.
- **The migration in phase 3 must run as its own execution** in the SQL editor (repo convention), and phase 3's UI must tolerate the columns not existing yet if someone runs the code first — read defensively.
- **This repo's Next.js is patched** (`frontend/AGENTS.md`): read `node_modules/next/dist/docs/` first; compose captions as plain strings (JSX entity whitespace fusion).
- **`monitoring_reports` has 0 rows**, so every screen here must be designed and demoed from its empty state first — and phase 1 cannot be called verified until a real report has been filed end-to-end.
- **Photos are private.** Keep storing paths and re-signing on view; never persist a signed URL.
