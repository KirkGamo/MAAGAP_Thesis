# MAAGAP — Project Reporting Loop Improvement Plan

_Drafted 2026-09-08. Scope: the full field-reporting feedback loop — inspector capture (`frontend/src/app/inspector/`), the submission action (`actions/submit-report.ts`), the ML rescore path (`ml-service/main.py`, `inference/live_scoring.py`), the manager-facing audit trail (`app/manager/reports/`), and — for §6's change to what the loop feeds back — the status encoding in `data_pipeline/preprocess.py` and `feature_engineering.py`. Fourth in the series after the dashboard, schedule, and inspectors plans; reuses the same single-viewport layout contract and progressive-disclosure doctrine._

---

## 1. Objectives

1. **Make the loop actually close.** It is broken today, silently — verified, not inferred (see §2.2). An inspector's report is saved, but the project it describes is never updated, and nothing anywhere reports the failure.
2. **Make the rescore observable and recoverable.** The webhook to the ML service is fire-and-forget with a 3-second timeout and no persisted outcome. When the service is down — its normal state — the risk tier silently never refreshes, and no one can tell which reports were absorbed and which evaporated. `submit-report.ts`'s own docstring says a dropped webhook "should be retried by the ML service side… (a dead-letter queue or a periodic reconciliation job)"; neither exists.
3. **Fit the field, not the desk.** An inspector files from a phone at a job site, on a connection that drops. Today a failed submit loses the form, there is no way to confirm a report landed, and no way to file for a project that isn't on today's route despite the UI asking the question.
4. **One screen, no scrolling** on the manager Reports tab at 1366×768 and up, same contract as the three rebuilt tabs, and stop signing up to 200 photo URLs per page render.
5. **Make the loop's output a usable retraining signal.** Field reports should feed the next retrain through **observed status**, not a subjectively-estimated percentage — and the status pathway itself has to be rebuilt before it can carry that weight (§6).

**Non-goals:** retraining on incoming reports (explicitly rejected in `live_scoring.py` — a single observation cannot justify it; the periodic batch retrain stays the mechanism, and §6 changes what that batch consumes); making `amount_spent` influence the score in this cycle (kept as bookkeeping); a full notifications backend.

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
- Optional `amount_spent`, labeled honestly (§9).
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

## 6. Observed Status, Not Percent Complete, as the Retraining Signal

### 6.1 Why percent complete has to go

An inspector standing at a site and typing "60%" is producing an unvalidated subjective estimate. Nothing calibrates it: two inspectors at the same site can differ by twenty points, there is no rubric, no inter-rater check, and no way to audit the number after the fact. Feeding that into a risk model would import the estimator's judgment as if it were measurement — and a panel is entitled to ask what "60% complete" means for a water system versus a training seminar.

It also currently buys nothing. `percent_complete` is not in the trained feature schema (`live_scoring.py`'s scope note), so today it costs field effort and yields no model signal at all.

**Observed status is the better primitive.** It is discrete, verifiable, photo-backable, and already the pipeline's own decision variable: `construct_target_variable()` routes every row on whether STATUS confirms completion. Most importantly, a *dated* transition to Completed produces a **real completion date**, which attacks the single largest caveat on every metric in this thesis — roughly 94% of the labeled population is proxy-dated (HANDOFF §7). Reports are the only mechanism that can retire that limitation project by project.

### 6.2 What blocks it today (verified)

The status pathway cannot yet carry a retraining signal, because the vocabulary was never actually controlled:

| Fact | Value |
|---|---|
| Trained feature columns | **137** |
| Of those, `STATUS_clean_*` one-hots | **57 (42%)** |
| `municipality_canonical_*` one-hots | 66 |
| Genuinely numeric/engineered features | ~14 |
| `STATUS_LOOKUP` entries in `preprocess.py` | **15**, self-described as "illustrative of the pattern, not exhaustive" |
| Distinct raw STATUS values it must cover | **278 raw / 238 normalized** (Data Audit DQ-3) |

Unmapped values pass through as their own category, so the trained schema contains one-hot columns such as `STATUS_clean_Completed/ 2 Cameras Are Dame During Road Co9Nstructiion Project And The Remaining Are Functional` and `STATUS_clean_Completd/ Distributed`. These are near-singleton columns keyed on typos. They cannot generalize: any new observation whose wording differs by a character matches none of them.

The live path inherits the damage. `live_scoring.STATUS_TO_COLUMN_SUFFIX` maps four app statuses to column suffixes, and:

- `completed` → `Completed/Functional` — column exists ✅
- `on_going` → `On-going` — exists ✅
- `not_yet_implemented` → `Not Implemented` — exists ✅
- `for_bidding` → `For Bidding` — **no such column in the trained schema** ❌
- `refunded` — **not in the map at all** (the enum gained it after this code was written) ❌

For those last two the code logs a warning and leaves the status one-hots untouched, so the report is recorded and *cannot move the score*. Silent, like the `projects` write in §2.2.

### 6.3 The change

1. **Adopt one controlled observation vocabulary**, shared end to end: the app's `project_status` enum is the canonical set, with an explicit two-way mapping to the pipeline's canonical labels. `refunded` gets a mapping for the first time.
2. **Collapse the historical free text into it.** Extend the 15-entry `STATUS_LOOKUP` into a full normalizer over the 238 values, reusing the cascade this project already validated for project type in D12: deterministic substring rules first (the `COMPLETED_STATUS_SUBSTRINGS` machinery already covers most of the "Completed/…" family), then a confidence-gated classifier for the residue, then explicit abstention — plus a `status_source` provenance column (`rule` / `classifier` / `unmapped`) so every row's basis is auditable, exactly as `project_type_source` does.
3. **Do not throw the nuance away.** The free text carries real information — damage, non-functionality, not-yet-turned-over. Rather than losing it with the 57 columns, extract it as a handful of orthogonal booleans (`status_has_damage`, `status_not_turned_over`, `status_partially_functional`) mined from the same strings. Net effect: ~57 unusable one-hots become ~6 dense status columns plus ~3 flags that generalize to wording never seen at train time.
4. **Hold the target variable fixed.** `construct_target_variable()`'s completion detection must keep using the current substring rules, unchanged, in this cycle. If the labels move at the same time as the features, the before/after comparison is uninterpretable — and RedFlag is what the entire thesis is graded on. Change the *encoding*; leave the *label* alone. Any later change to target construction is its own decision note.
5. **Retrain and report both.** Full re-run of pipeline steps 3–6 (HANDOFF §4), then publish current-vs-new metrics side by side rather than overwriting the headline numbers, and reseed Supabase.
6. **Fix the live path to match.** Point `STATUS_TO_COLUMN_SUFFIX` at the canonical vocabulary, add `refunded`, and turn an unmapped status from a silent log line into a `rescore_state = 'failed'` with a reason the manager can see (§5.2).
7. **Change the capture form.** Remove the `percent_complete` input. Replace it with the controlled status list plus optional qualifier checkboxes feeding the §6.3.3 flags — objective observations an inspector can defend, and strictly more signal than a percentage. The existing `monitoring_reports.percent_complete` column stays for historical rows; it simply stops being written.

### 6.4 Expected effect, stated before running it

Feature count should fall from 137 to roughly 85. Accuracy may **drop**, and that would not be a regression to hide: 57 near-singleton one-hots are exactly the shape of features a tree ensemble can memorize, so part of the current 0.849/0.924 test accuracy may be identifier-like fitting on typo strings rather than learned structure. A slightly lower score on a schema that generalizes to unseen wording is the better model and the more defensible thesis result. Committing to that expectation *now*, in writing, is what makes the post-retrain comparison honest.

Record the whole change as `second-brain/02-Decisions/D16-Observed-Status-Feature-Encoding.md`, following D12–D15's format, and regenerate the methodology report (HANDOFF §8) since its headline metrics will move.

## 7. Phases (branch `feat/reporting-loop`, atomic commits)

| # | Commit | Risk |
|---|---|---|
| 1 | `fix(reports): apply project status changes from field reports` — §5.1, the silent no-op. Highest value, no schema change. | Medium (privileged write; needs the authorization check to be exactly right) |
| 2 | `feat(reports): single-viewport master-detail reports workspace` — §5.4, incl. the photo-signing fix | Low |
| 3 | `feat(reports): record and retry rescore outcomes` — §5.2 (migration + service + UI) | Medium — DB migration, run by hand |
| 4 | `feat(inspector): file for any assigned project, see recent submissions` — §5.3 first half | Low |
| 5 | `feat(inspector): backdated visits, amount spent, offline-tolerant submit` — §5.3 second half | Medium — offline queue |
| 6 | `feat(pipeline): normalize observed status into a controlled vocabulary` — §6.3 steps 1–4, plus the D16 decision note. Pipeline only; no retrain yet, so the encoding change can be reviewed on its own. | Medium |
| 7 | `feat(ml): retrain on normalized status, drop percent complete from capture` — §6.3 steps 5–7: full retrain, before/after metrics table, Supabase reseed, live-path mapping fix, form change, methodology report regenerated | **High — moves the thesis's headline metrics** |

Push after 1, 3, and 6. Each phase: `tsc`, `npm run build`, `npm run lint` (no new findings in touched files), screenshots at 1366×768/1440×900 asserting height equals viewport, and — for phase 1 — an end-to-end run filing a real report and confirming the project row actually changes. Phases 6–7 additionally require the pipeline verification checkpoints in HANDOFF §4 (the `Step 6: labeled N/D rows` line and the meta-learner's training-set size) to be re-read and re-recorded, since both will shift.

## 8. Information-Overload Budget (before → after)

- Manager landing surface: a 7-column × 200-row table with every remark and photo strip inline → a one-line-per-report list plus one detail pane.
- Horizontal scrolling on the Reports tab: present → none.
- Storage round trips per render: up to 200 → 1.
- Loop-health information: none → three counters plus a per-report state.
- Inspector's answer to "did it send?": none → an explicit state on their own list.
- Field inputs an inspector must subjectively judge: one (a percentage) → **zero** (§6).

## 9. Risks & Gotchas (read before coding)

- **The privileged write is the whole risk of phase 1.** A service-role client bypasses RLS entirely, so the assignment check *is* the security boundary. Verify it denies an inspector writing to a project they were never assigned, and keep the write to exactly `status`/`date_of_completion`.
- **Phases 6–7 move numbers the manuscript cites.** The methodology report is kept in sync with every pipeline change (HANDOFF §8) and its headline metrics will shift. Regenerate it, keep the before/after table, and do not quietly replace the old figures — the comparison is the evidence that the encoding change was an improvement in generalization rather than a loss of accuracy.
- **Never change the target and the features in the same retrain.** RedFlag construction stays on its current substring rules through phase 7 (§6.3.4). Moving both at once makes the comparison meaningless and puts the thesis's central variable in play without a controlled test.
- **A shrinking feature space can look like a regression.** Expect accuracy to move, possibly down (§6.4). Pre-committing to that expectation before running the retrain is what keeps the result honest; if it improves, that is a stronger claim, not a lucky one.
- **`amount_spent` still cannot move a risk score** until it is added to `feature_engineering.py` Step 9 and included in a retrain — the trained feature schema is frozen (`live_scoring.py`'s scope note). Collect it as bookkeeping and label it that way in the UI; do not imply the score responded to it. The same was true of `percent_complete`, which §6 removes rather than promotes.
- **`for_bidding` and `refunded` observations currently cannot move a score at all** (§6.2) — until phase 7 lands, treat any such report as recorded-but-unscored rather than assuming the tier reflects it.
- **Status regression is legitimate.** A field observation may correct a wrong status downward. Record every transition rather than blocking it, but never wipe a `date_of_completion` that already exists.
- **The ML service is usually offline.** Every rescore-derived element degrades to "pending" with a Retry, never an error state — the stance already used by the Schedule scorecard and the Inspectors slot list.
- **The migration in phase 3 must run as its own execution** in the SQL editor (repo convention), and phase 3's UI must tolerate the columns not existing yet if someone runs the code first — read defensively.
- **This repo's Next.js is patched** (`frontend/AGENTS.md`): read `node_modules/next/dist/docs/` first; compose captions as plain strings (JSX entity whitespace fusion).
- **`monitoring_reports` has 0 rows**, so every screen here must be designed and demoed from its empty state first — and phase 1 cannot be called verified until a real report has been filed end-to-end.
- **Photos are private.** Keep storing paths and re-signing on view; never persist a signed URL.
