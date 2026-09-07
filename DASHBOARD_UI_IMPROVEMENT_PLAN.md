# MAAGAP — Dashboard Interface Improvement Plan

_Drafted 2026-09-08. Scope: the Manager Overview page (`frontend/src/app/manager/page.tsx`) and its supporting components. Centerpiece: a new, prominently placed **Portfolio Demographics** chart section (PPAs per municipality, PPAs per year, and related breakdowns of the current dataset)._

---

## 1. Objectives

1. Make the Overview page answer the panel-defense question *"what does the current PPA portfolio actually look like?"* — not just *"what is risky?"* Today every visual on the page is risk-scoped; there is no descriptive view of the data itself.
2. Give the demographic charts (PPAs per Municipality, PPAs per Year, by Project Type, by Status, budget distribution) visual priority on the page, per the developer's request.
3. Fix a scoping blind spot: the current page queries `.not("risk_tier", "is", null)`, so **1,725 of 2,393 live projects (72%) are invisible** on the dashboard (they are unscored because they lack an LSTM sequence — a known coverage caveat, not a defect). Demographic charts must describe the *whole* seeded population.
4. Keep the existing risk-focused widgets (KPI header, tier cards, Tracker, risk-by-municipality bar chart) but reorganize them into a clearly labeled risk section.

**Non-goals:** no changes to the ML pipeline, Supabase schema, or seeding scripts. All charts are derivable from columns already on `public.projects`.

---

## 2. Current State (what exists today)

| Element | File | Scope problem |
|---|---|---|
| KPI header (Active / Critical / Inspector Capacity) | `manager/kpi-header.tsx` | Fine — already portfolio-wide |
| 4 risk-tier count cards | `manager/page.tsx` | Scored-only |
| Tracker strip (first 120 scored projects) | `manager/page.tsx` | Scored-only, arbitrary cap |
| High/Critical vs Low/Medium by municipality (top 10) | `manager/page.tsx` | Scored-only; only 10 of 44 LGUs |
| "Next steps" onboarding card | `manager/page.tsx` | Fine |

Available chart primitives: only the vendored Tremor Raw `BarChart` (`components/tremor/bar-chart.tsx`, verbatim source + `chart-utils.ts` with a fixed 9-color palette: blue, emerald, violet, amber, gray, cyan, pink, lime, fuchsia). No Donut/Line/Area chart is vendored yet.

Available data on `public.projects` (2,393 rows as of the 2026-08-31 reseed): `municipality`, `amount_php`, `status` (5-value enum incl. `refunded`), `date_released`, `date_of_completion`, `date_last_monitored`, `project_type` (Infrastructure / Non-Infrastructure / Unclassified), `risk_tier`, `risk_probability`, `latitude`/`longitude`.

---

## 3. Proposed Page Layout

```
┌──────────────────────────────────────────────────────────────┐
│ KPI header (unchanged, own Suspense boundary)                │
├──────────────────────────────────────────────────────────────┤
│ H1 "Overview" + subtitle                                     │
├──────────────────────────────────────────────────────────────┤
│ ★ PORTFOLIO DEMOGRAPHICS  (new section — visually dominant)  │
│ ┌────────────────────────────┬────────────────────────────┐  │
│ │ PPAs per Municipality      │ PPAs per Year              │  │
│ │ (all 44 LGUs, horizontal   │ (grouped/stacked bars by   │  │
│ │  bars, stacked by project  │  year of date_released,    │  │
│ │  type, scrollable)         │  split by project_type)    │  │
│ ├──────────────┬─────────────┴─┬──────────────────────────┤  │
│ │ By Status    │ By Project    │ Budget (₱) per           │  │
│ │ (bar/donut)  │ Type (donut)  │ Municipality (top 10)    │  │
│ └──────────────┴───────────────┴──────────────────────────┘  │
├──────────────────────────────────────────────────────────────┤
│ RISK ASSESSMENT (existing widgets, regrouped under header)   │
│ - 4 tier cards  - Tracker strip  - risk-by-municipality bar  │
│ - "N of M projects scored" coverage note (honest caveat)     │
├──────────────────────────────────────────────────────────────┤
│ Next steps card (unchanged)                                  │
└──────────────────────────────────────────────────────────────┘
```

Section headers use the existing `text-brand-navy` heading style; demographics gets the top slot and a 2-then-3 responsive grid (`grid-cols-1 lg:grid-cols-2`, then `md:grid-cols-3`) so it reads as the page's centerpiece.

---

## 4. The Demographic Charts (the highlight)

All charts below query **all** rows of `projects` (drop the `risk_tier` filter for this section). One server-side select of the needed columns (`municipality, status, project_type, amount_php, date_released, risk_tier`) feeds every chart — 2,393 rows aggregates trivially in the Server Component; no RPC needed.

### 4.1 PPAs per Municipality (primary chart)
- **Form:** horizontal bar chart (`BarChart layout="vertical"`), one bar per municipality, sorted descending by count, stacked by `project_type` (`type="stacked"`).
- **Coverage:** all 44 LGUs, not top 10. Wrap in a fixed-height scroll container (`max-h-[32rem] overflow-y-auto`) with the chart height sized to `municipalities × ~28px`, or add a Top 10 / All toggle (small client component, same pattern as `ppas/view-toggle.tsx`).
- **Colors:** Infrastructure `blue`, Non-Infrastructure `cyan`, Unclassified `gray` — deliberately distinct from the amber/emerald risk convention so demographic charts never read as risk charts.
- **Null handling:** rows with null `municipality` are counted in a one-line footnote ("N PPAs without a resolved municipality are excluded"), mirroring the existing exclusion comment in `page.tsx` — never a silent drop.

### 4.2 PPAs per Year
- **Source:** `EXTRACT(year FROM date_released)` equivalent in TS (`date_released.slice(0, 4)`).
- **Form:** vertical bar chart, one bar group per year in ascending order, stacked by `project_type`. A stacked bar (not a line) is correct here: few discrete years, count data.
- **Null handling:** null `date_released` rows go into an explicit "No release date" bucket at the end, or a footnote count — decide by how large the bucket is once measured (if >15% of rows, show the bucket; hiding it would misrepresent the portfolio).
- **Caveat to render in the card's sublabel:** this charts the *currently seeded live population* (the 2,393-row `inference.csv` cohort), not the full 8,277-row historical training dataset. Phrase as "PPAs in the current monitoring portfolio by year of fund release."

### 4.3 PPAs by Status
- **Form:** compact horizontal bar (5 statuses: on_going, completed, for_bidding, not_yet_implemented, refunded), using the existing status badge labels/order from `ppas/columns.tsx` for terminology consistency.

### 4.4 PPAs by Project Type
- **Form:** donut (requires vendoring Tremor Raw `DonutChart` — see §5) or, if deferring that, a single stacked 100% bar (`type="percent"`) which the existing BarChart already supports. **Recommendation: start with the percent-stacked bar; vendor DonutChart only if the visual weight feels wrong in review.** Fewer new verbatim-vendored files = smaller diff.

### 4.5 Budget per Municipality (secondary)
- **Form:** horizontal bar, top 10 municipalities by `SUM(amount_php)`, single series (`violet`).
- **Formatter:** compact PHP currency ("₱12.4M"). Since `page.tsx` is a Server Component and functions can't cross the boundary as props (the documented Phase 10 constraint), create a thin `"use client"` wrapper — `manager/charts/currency-bar-chart.tsx` — that closes over the formatter internally and takes only serializable props. This wrapper pattern then also unlocks proper count formatters on the other charts.

---

## 5. Component Work

1. **`manager/charts/` directory** — new client wrapper components (`demographics-bar.tsx`, `currency-bar-chart.tsx`), each a thin shell over the vendored `BarChart` that owns its `valueFormatter`/`colors`. Keeps `page.tsx` a pure Server Component.
2. **Section header component** (or just consistent `<h2>` markup) for "Portfolio Demographics" / "Risk Assessment".
3. **Optional (phase 2): vendor Tremor Raw `DonutChart`** the same way `bar-chart.tsx` was vendored: verbatim source, import-path adjustments only, lucide-react icon swap if needed, documented in the file header.
4. **Skeletons:** extend `manager/loading.tsx` with placeholder cards matching the new grid so the page doesn't jump on load.

---

## 6. Data & Correctness Rules

- **One query, two scopes.** Fetch all projects once; demographic aggregations use every row, the risk section filters to `risk_tier != null` in memory. Removes the second round trip and makes the scoping difference explicit in code.
- **Every exclusion is visible.** Null municipality / null date_released / unscored counts each get a rendered footnote, consistent with the project's "honest labeling" convention (cf. the KPI header's coverage-ratio comment).
- **Terminology:** use "PPAs" in all card titles (matches the nav and sidebar), municipality names as seeded (already PSGC-resolved upstream).
- **Color discipline:** amber/emerald/red/orange stay reserved for risk semantics; demographics use blue/cyan/violet/gray. This is the single most important visual rule — a blue municipality chart next to an amber risk chart lets the eye separate "description" from "alarm" instantly.

---

## 7. Implementation Phases (atomic commits, branch `feat/dashboard-demographics`)

| # | Commit | Content |
|---|---|---|
| 1 | `feat(dashboard): add portfolio demographics data aggregation` | Single-query fetch + aggregation helpers (pure functions, unit-testable) in `manager/lib/portfolio-stats.ts` |
| 2 | `feat(dashboard): add client chart wrappers with formatters` | `manager/charts/*` client components |
| 3 | `feat(dashboard): add PPAs-per-municipality and PPAs-per-year charts` | The two headline charts + section header, page regrouped |
| 4 | `feat(dashboard): add status, project-type, and budget breakdown charts` | Remaining three cards |
| 5 | `feat(dashboard): update loading skeletons for new overview layout` | `loading.tsx` |
| 6 | (optional) `feat(tremor): vendor Tremor Raw DonutChart` | Only if percent-bar is rejected in review |

Push after phase 3 (first coherent milestone) and again after phase 5.

## 8. Verification

- `npm run lint` and `npm run build` in `frontend/` after each phase.
- Cross-check chart totals against Supabase: sum of municipality bars + null-municipality footnote = 2,393; year buckets + null-date footnote = 2,393; risk section still totals 668 scored (614 Low / 26 Medium / 9 High / 19 Critical per the 2026-08-31 reseed).
- Visual check at 375px, 768px, 1280px widths (the 44-LGU chart is the layout-risk item).

## 9. Risks & Gotchas (read before coding)

- **This repo's Next.js is not stock** — `frontend/AGENTS.md`: read the relevant guide in `node_modules/next/dist/docs/` before writing any code; APIs may differ from training data.
- **Server/client boundary:** no function props into `"use client"` components (bit this project once already — Phase 10). All formatters live inside client wrappers.
- **BarChart palette is closed:** only the 9 named colors in `chart-utils.ts` work; arbitrary Tailwind classes silently fall back to gray.
- **44-bar chart height:** Recharts inside `ResponsiveContainer` needs an explicit pixel height for a scrollable tall chart; compute it from the municipality count rather than hardcoding.
- **`date_released` nullness is unmeasured** — measure the null share first (one query) before deciding bucket-vs-footnote in §4.2.
