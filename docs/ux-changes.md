# MAAGAP — UX changes to the Schedule, Inspectors, Models and Reports tabs

_Completed 2026-10-08. Companion to `docs/ux-audit.md`, which records the Phase 0 audit and the five scope decisions this work was built on._

---

## 0. What this pass turned out to be

It was commissioned as a layout and information-architecture overhaul of four pages. The audit found that three of the four had already been rebuilt in September to written plans, and were bound by a verified single-viewport contract the brief's page anatomy could not fit. Those three therefore received targeted changes; **Models**, the only one of the five manager tabs with no plan and no contract, received the restructure.

**Four of the ten commits fix defects rather than layout**, three of them from one root cause. That is the more important outcome, and it is worth stating plainly: the brief asked for a visual pass, and carrying it out surfaced a wrong number on the Models page, a false all-clear on Inspectors, and a CSV export that had been silently dropping 58% of the portfolio.

| Commit | What |
|---|---|
| `ae50c86` | Phase 0 audit |
| `7070607` | **defect** — Inspectors claimed an all-clear it could not know |
| `edb43fa` | **defect** — Models score_basis split truncated at 1,000 rows |
| `172acbd` | **defect** — PPA CSV export returned 1,000 of 2,393 rows |
| `d67cfd5` | Models restructured |
| `f1190f9` | Schedule: retry for the degraded optimizer state |
| `3252942` | Schedule: capacity pressure on the day tabs |
| `c843bd4` | Reports: sorting and differentiated empty states |
| `4b6d3cd` | Shared `PageHeader` |
| `8f24893` | **defect** — 13 text styles below AA; Overview had no `h1` |

---

## 1. Before and after, per page

### Schedule

| Before | After |
|---|---|
| ML service unreachable showed a muted chip and nothing to do about it; the error boundary's "Try again" could never fire, because the failed fetch is caught and degraded by design | A **Retry** re-runs the server render, and distinguishes "not tried" from "tried, still failing" |
| Over-capacity inspectors were flagged only inside the day being viewed, so the week's problem days were invisible from the tabs | Each day tab carries a marker when an inspector exceeds the solver's daily capacity |

Unchanged, and deliberately: the Calendar/Timeline/List switcher was declined. Day-versus-week disclosure already exists and is URL-synced, and a third view would reinstate the five-column board the September rebuild deleted.

### Inspectors

| Before | After |
|---|---|
| With the ML service down, the headline read **"1 of 1 optimizer slot filled — every slot can receive deployed work"**, against a true state of 1 of 6 with 21 of 25 visits undeployable | States what is known and names what is not: *"1 inspector holds an optimizer slot — the roster size is unknown while the ML service is unreachable"* |
| A "0 slots empty" chip rendered in the ok tone, from a count that cannot be known without the solve | The chip is withheld when the roster is unknown |

This was the one defect found that could cause a wrong operational decision. The page issued its strongest reassurance exactly when it had the least information, and the truth only surfaced two tabs away at the Schedule deploy step — which is the failure the September rebuild existed to prevent.

### Models

| Before | After |
|---|---|
| Eight equally-weighted cards over **2.48 screens** | **One screen** at 1366×768; 1703px even fully expanded, shorter than it used to be collapsed |
| Opened with the three-learner's 88.8% — a model scoring a minority of projects, measured on a 598-row subset | Opens with which model actually produced the live tiers: 72% of scored projects, 76% of High and Critical |
| `score_basis` split read 70% (698/1000) and 80% (20/25) | 72% (1725/2393) and 76% (76/100) |
| Accuracy and its population separated | Population rendered adjacent to the number it qualifies |
| Non-comparability warning was a footnote inside one card | A full-width strip, because it governs how both cards must be read |
| No explanation of any metric | Plain-language glossary behind disclosure |

The 76% figure matters beyond the arithmetic: it is the exact number `D23-Keep-The-LSTM.md` cites as a finding, so the page had been contradicting the thesis's own decision record on the screen most likely to be checked against it.

### Reports

| Before | After |
|---|---|
| Fixed newest-first order on a list that grows permanently with every field visit | Newest, oldest, or **awaiting re-score first** |
| One sentence for two different empty states | Filtered-empty offers "Clear filters"; genuinely empty explains where reports come from |

### PPAs (touched, though not in the brief's scope)

The CSV export returned 1,000 of 2,393 rows — HTTP 200, a well-formed file, 58% of the portfolio missing and nothing to indicate it. The route's own docstring already promised *"Always exports every matching row (no pagination)"*. It is also scripted task **A8** in `docs/ISO25010_Evaluation_Instrument.md`: had the evaluation run first, respondents would have completed that task with an incomplete file and rated it as working.

---

## 2. New shared components

### `components/page-header.tsx`

```tsx
<PageHeader
  title="Reports"
  description={headline}
  density="compact"            // "compact" when the page is pinned to 100dvh
  actions={<ReportsFilters />} // optional, rendered opposite the title
/>
```

Six pages carried their own copy. Auditing them found **no drift** — and that the variation which exists is a rule: pinned pages use `text-xl`/`text-xs`, scrolling pages `text-2xl`/`text-sm`, with no exceptions. A page spending a fixed height budget gets a compact header. Nothing recorded that, so `density` names the reason rather than the size.

`PageToolbar` was **not** extracted. The three toolbars share nothing beyond being flex rows; a component whose entire body is a `div` with one class is indirection, not reuse.

### `schedule/scorecard-retry.tsx`

Client island for the degraded optimizer state. `router.refresh()` rather than a client re-fetch, because the summary is read during the server render.

### Extracted for testability

- `schedule/capacity.ts` → `daysOverCapacity(visits)`
- `reports/lib/sort.ts` → `sortReports(reports, sort)`, `parseReportSort(raw)`

Both were extracted for the same reason: **their important branch cannot be reached from live data.** No week is over capacity (the fullest sits at exactly 12/12 and 3/day), and no report is awaiting re-score. A rule that only ever evaluates false in practice is one nobody would notice was wrong, so it is pinned by test instead of by observation.

---

## 3. Behaviour changes

- **Tokens renamed.** `--field-ink-muted` / `--field-ink-faint` → `--ink-muted` / `--ink-faint`, applied app-wide. The failing greys were not specific to sunlit screens, so the `field-` prefix was a misnomer. 119 occurrences across 46 files.
- **Description text is darker** on every page carrying a `PageHeader`: 4.76:1 → 6.03:1. The one rendered difference from the header extraction, and deliberate.
- **Overview gained an `sr-only` `h1`.** It had none, so assistive tech announced a document with no name. Not visible, because the page is pinned at exactly its height budget.
- **`?sort=` added** to Reports. Absent or unrecognised falls back to newest-first.
- **The PPAs page header stacks below `sm`**, fixing 15px of horizontal overflow at 390px.

Nothing was removed. Every action available before remains reachable, and no caveat was cut from the Models page — it reads as text-heavy because it is unusually honest about what the models can claim, and disclosure was the fix rather than deletion.

---

## 4. Final checklist

| | Schedule | Inspectors | Models | Reports |
|---|---|---|---|---|
| URL-synced state | `?day=` | n/a — nothing to filter | n/a | `?q= ?inspector= ?report= ?sort=` |
| Loading state | `loading.tsx` | `loading.tsx` | `loading.tsx` | `loading.tsx` |
| Empty state | per-day agenda empty copy | empty-slot cards name their own cost | sections omitted when absent, never zeroed | two distinct states, one with an action |
| Error state | `error.tsx` + **retry on the degraded path** | `manager/error.tsx` | `error.tsx` | `manager/error.tsx` |
| Keyboard | overlays trap focus, close on Esc, return focus | invite panel likewise | all four disclosures Tab + Enter | sort control labelled and reachable |
| Text contrast | 0 below AA | 0 below AA | 0 below AA | 0 below AA |
| One screen @1366×768 | yes | yes | **yes (was 2.48 screens)** | yes |
| No overflow @1024/1280 | yes | yes | yes | yes |

Across all six manager pages: **0 text styles below AA** (was 13), **0 landmark issues** (was 1), **0 controls without an accessible name**, and a visible focus indicator on every tab stop checked. Build clean, 60 tests pass.

---

## 5. Follow-ups

**Needs backend support**

1. **Expose the paired meta-learner comparison.** `artifacts/meta_learner_paired_comparison.json` holds the per-metric deltas, but the ML service serves no endpoint for it, so the Models page states McNemar p = 0.189 as prose. Hardcoding the full table into the view would reproduce the defect fixed in `edb43fa` — a screen drifting from its decision record.
2. **Roster size when the solver is unreachable.** Nothing is cached between requests, so the Inspectors page genuinely cannot know the roster size offline. Persisting the last known solve summary would let it say "1 of 6 (as of yesterday)" instead of "unknown".

**Deferred, and why**

3. **Clickable summary-stat filters on Inspectors.** Six slots and one inspector; filtering a six-card grid adds interaction without reducing anything. Revisit if the roster grows.
4. **A "Conflicts" quick filter on Schedule.** At most 18 visits a week, all visible in one agenda on one screen. The indicator carries the value; the filter earns its place on a schedule large enough to hide a conflict.
5. **A report generator** (templates, presets, preview, PDF/CSV export, saved history). Out of scope per `ux-audit.md` §5 — this page is an audit trail of inspector submissions. If wanted, it needs its own scoping, starting with who receives the documents.
6. **Side-by-side model comparison.** Declined, not deferred. It would render 88.8% against 92.6% as like-for-like, which `D23` records as confounded.

**Known limits**

7. **Unbounded reads.** A sweep found 37 Supabase reads, 16 unbounded; only `projects` (2,393 rows) can exceed PostgREST's 1,000-row cap, and all three reads touching it are now paged. The reads on `inspector_schedules` and `profiles` are unbounded but correct at current sizes (18 and 2 rows) — they would break past 1,000, which is implausible for a weekly schedule or an inspector roster. **Any new full-table read needs explicit pagination.**
8. **Two branches are covered by test only**, because live data cannot reach them: the over-capacity day marker, and the no-reports-at-all empty state.
9. **Disclosure open/closed state on Models is not URL-synced.** Native `<details>` was chosen over a JS accordion for keyboard support, screen-reader announcement, and in-page find working while collapsed; linking to "Models with Level 0 expanded" is not a real need.
10. **The live roster is in a bad state** and this is an operational matter, not a code one: 1 of 6 slots filled, so 48 of the latest solve's 60 visits route to slots nobody holds and will be skipped at deploy. Assigning the remaining five slots is the highest-value unblock for the Schedule feature.
