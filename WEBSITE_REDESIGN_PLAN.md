# MAAGAP — Website Redesign Plan

_Drafted 2026-10-05. **Rewritten 2026-10-06 after an audit found the first version substantially overstated the work.** Scope: the design tokens in `frontend/src/app/globals.css`, the login page, the project detail page, and two small gaps on the PPAs list and the inspector report form._

---

## 0. Why this was rewritten

The first version of this plan was generated from file-level greps and prose-block counts without opening the components it described. Three of its five workstreams were wrong about what already existed:

| Original claim | Audited reality |
|---|---|
| "SHAP contributions render as a text list" — called *the single highest-value change in the plan* | `shap-chart.tsx` already renders a diverging bar chart: centre zero-line, bars scaled to max \|shap\|, per-bar colouring by sign, pp labels. Built in Phase 22 |
| "Project detail: 10 prose blocks to 2 visual elements" | 7 prose blocks, two of which are lead-ins to structured content. The page also has a semantic indicator list with icons and flagged states, and photo thumbnails |
| "The inspector pages were never covered by the September series" | `REPORTING_LOOP_IMPROVEMENT_PLAN.md` scopes `frontend/src/app/inspector/` in its first line, and its objective 3 is *"Fit the field, not the desk"* |
| "PPAs needs filter chips and a risk-default sort" | A 375-line filter sidebar covers status, tier, project type, municipality and amount; the query already sorts by `risk_probability` descending |

The parts that survived audit — the contrast measurements and the absence of surface hierarchy — were the parts that came from measuring rather than from grepping. That is the lesson worth carrying: **open the component before claiming what it does.**

---

## 1. Objectives

1. **Give the design system the means to express hierarchy.** It defined eight brand colours and nothing else — no elevation scale, no semantic scale, no surface roles — so every block was a white card with the same border and radius, and nothing read as more important than anything else. *This, not the canvas colour, is why the app looked plain.* **Shipped.**
2. **Give the login page an identity.** It was a `max-w-sm` form on grey that never referenced the committed logo. **Shipped.**
3. **Make the project detail page's risk story coherent** — the tier, its change, and which model produced it, as one designed unit rather than loose spans. **Shipped.**
4. **Close two small gaps** on the PPAs list and the inspector form. **Shipped** — and both turned out to be covering a real defect: a truncated facet query and two text styles below AA.
5. **Disturb nothing in the four September tabs** beyond the new tokens. Their one-screen contract at 1366×768 is a constraint on this work, not a target for it.

---

## 2. What shipped (phases 1–2)

### 2.1 Design tokens — `22b9a5b`

**Surface roles** (`base`, `sunk`, `raised`, `inverse`), so border/radius/shadow apply by role rather than uniformly.

**A risk ramp separate from the brand,** with two roles for two jobs:

- `--risk-*` (solid) for marks, stripes and chart fills, tuned so relative luminance falls monotonically — **0.288, 0.205, 0.135, 0.075**, each step ~1.4× apart. Darker always means more severe, so the scale survives greyscale, colour-vision deficiency, and a projector that renders orange and red as the same brown. All four clear 3:1 on white.
  *The conventional green/amber/orange/red ramp does not have this property: measured, its Medium and High sit at 0.237 and 0.239 — identical once hue is removed.*
- `--risk-*-soft` + `--risk-*-ink` for badge pills, where the tier **word** carries the meaning. Each ink is the *lightest* value clearing 4.5:1 on its own background, so tiers keep their hue identity instead of collapsing to near-black — which is what a "darken until it passes" search produces, and was the first thing tried.

**Density tokens** for two devices, and `tabular-nums` on tables globally.

### 2.2 Login — `e0e8567` … `2619e23`

Two-panel layout; the acronym expanded from the manuscript; both roles named; 44px controls applied locally rather than to the shared `Input`, which would have added height to every form in the app.

**Navy is scoped by exposure time.** `#242467` is 48% saturation at 27% lightness. On a ten-second login screen that is a fair trade for identity; behind eight hours of risk tables it is a fatigue cost. Text on it is off-white `#E8ECF5` (11.65:1), never pure white (13.79:1) — WCAG sets a floor, not a ceiling, and contrast that high on a saturated dark ground halates.

**The brand reaches light surfaces through `--color-brand-sky-dark` `#077CA9`** (4.70:1 on white), not by darkening the pages. There is deliberately no `cyan-dark`: darkening cyan far enough to pass moves it to 193°, within four degrees of darkened sky.

Three defects were measured in the logo: a pure-white field with no alpha; a darkest ink of `#242367` against a `#242467` panel, making the leading "M" invisible (49% of inked pixels below 3:1); and a rendered aspect of 11.20:1 against a natural 4.84:1 — **flexbox `align-items: stretch`, not the asset.**

---

## 3. Remaining work

### 3.1 Project detail (`app/manager/ppas/[projectId]/`) — ~1 day

The SHAP chart and the indicator list already exist and stay as they are.

- **A risk header band** carrying tier, probability, Δ since last score and `score_basis` as one designed unit, rather than three sibling spans.
- **Surface `score_basis`.** It is persisted (R4) and never shown, so a manager cannot see which model produced a tier — and 76% of High/Critical come from the two-learner configuration.
- **Score history as a sparkline.** `project_score_history` exists; nothing renders the series.
- **Demote the caveats, do not delete them.** The notes explaining that a completed project can still carry a high tier, and that a score reflects elapsed time as well as observation, are correct and unusual in a student system. They move behind a *How to read this* disclosure, each keeping a visible affordance.
- **Reports as a timeline** rather than a table — optional. Note `% complete` is a permanently empty column; the form deliberately does not collect it.

### 3.2 PPAs list — **shipped**

- **Counts on each filter option**, right-aligned and tabular.
- **A leading severity stripe per row**, using the solid ramp.

Adding the counts exposed a **pre-existing data bug** that had been invisible
while the sidebar showed labels only. The facet query was an unbounded
`select()`, which PostgREST caps at **1,000 rows**, so it had been describing
only the first 1,000 of 2,393 projects — and the *municipality list* was built
from that same query, meaning the Municipality filter had been silently missing
every municipality that appears only later in the table. The counts made it
visible because status and risk tier each summed to exactly 1,000:

| | before (capped) | after (paginated) |
|---|---|---|
| risk tier counts sum | 1,000 | **2,393** = population |
| Low | 959 | 2,244 |
| municipality options | truncated set | **44**, summing to 2,345 |

2,345 rather than 2,393 is correct: 48 projects have a null municipality, which
the filter deliberately excludes. *A count is a test of the query behind it —
labels alone concealed a wrong result for as long as they were only labels.*

The four-viewport sweep also found **15px of horizontal overflow at 390px**,
from the header's non-wrapping flex row holding a 261px action group beside the
title. It now stacks below `sm`. Not caused by the stripe, which sits inside the
table's own scroll container.

### 3.3 Inspector form — **shipped**

- **The file-input button** is now 44px, matching the rest of the form.
- **Sunlight legibility: measured, and it failed.** This was the one claim the
  audit could not settle from the code. Measured in-browser with every colour
  normalised through a canvas — necessary because Tailwind v4 emits `oklch()`,
  which naive string parsing silently mis-reads — **two of six text styles on
  the report screen were below AA**:

  | | before | after | 
  |---|---|---|
  | 12px eyebrow labels (`text-slate-400`) | **2.46:1** | 5.07:1 |
  | 14px secondary text (`text-slate-500`) | **4.45:1** | 5.63:1 |

  The failure was systemic across all of `src/app/inspector/` — 19 occurrences,
  not one form — so the fix is two tokens rather than nineteen edits:
  `--field-ink-muted` #566477 and `--field-ink-faint` #5b6b82. Both sit well
  above 4.5:1 deliberately: ambient light raises a screen's rendered black
  level, so a glare-free measurement is an *upper bound* on what an inspector
  sees at a job site. For the dimmest text on the only outdoor screen, AA is a
  floor to clear with room, not a number to hit. All **28** text styles across
  the three inspector screens now pass.

**Left undone, deliberately:** the nav's "Sign out" button is 36px, below the
44px floor. It is outside the form, and growing it would grow the shared nav and
put the four September tabs' one-screen contract at risk for a control used once
per shift. Recorded rather than changed.

---

## 4. Implementation (branch `feat/interface-redesign`, atomic commits)

| Phase | Work | Effort | Status |
|---|---|---|---|
| 1 | Design tokens | 1d | **shipped** |
| 2 | Login | 1d | **shipped** |
| 3 | Project detail — risk band, `score_basis`, sparkline, disclosure | 1d | remaining |
| 4 | PPAs — filter counts, severity stripe, header wrap | 2h | **shipped** |
| 5 | Inspector — touch target, field-grade text tokens | 30m | **shipped** |

**All five phases shipped.** The audit's revised estimate of ~1.5 days for phases 3–5 held.

---

## 5. Verification

1. **Every brand colour used for text passes AA against its own surface.** Re-measure; do not assume.
2. **The four September tabs still fit one screen at 1366×768** — full-page height equals viewport height. Verified with puppeteer after every token or font change, because those are app-wide and reach pages nobody looked at.
3. **Risk tier is never carried by hue alone**, on any surface.
4. **No horizontal or vertical overflow** at 1868×950, 1493×762, 1280×720 and 390×844.

---

## 6. Risks & Gotchas (read before coding)

- **Open the component before claiming what it does.** This plan's first version was written from greps and was wrong about three of five workstreams. The September series had already built much of what it proposed.
- **Token changes are cross-cutting.** Verify the September tabs after a token or font change, not at the end. If a token forces a tab to scroll, the token is wrong, not the tab.
- **The caveats are a feature.** The project detail page reads as text-heavy because it is unusually honest about what the model can and cannot claim. Progressive disclosure is the fix; cutting them for a cleaner screenshot trades integrity for tidiness.
- **Light-only is deliberate.** `color-scheme: light` is forced for a recorded reason — native controls rendering white-on-white under a dark OS preference. Dark mode is a separate decision.
- **Percentage `background-position` is `(container − image) × percent`.** A 670px image in an 843px panel moves 21px at `112%`. Use pixel offsets when you want a definite shift.
- **Tailwind drops a utility silently when its token is missing.** A clean build does not prove a new token works; check the generated CSS.
- **An unbounded Supabase `select()` returns at most 1,000 rows, with no error.** Any full-table read needs explicit pagination. This silently truncated the PPAs facet query for as long as it existed, and the only reason it surfaced was that someone rendered a number next to a label.
- **Normalise colours through a canvas before computing contrast.** Tailwind v4 emits `oklch()`; parsing the first three numbers out of a computed `color` string yields a plausible, wrong ratio rather than an error.
- **These screens are only honest against real data.** Every one is a different problem at 2,393 projects than at six placeholder rows, which is why this plan does not route through a mock-up tool.
