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
3. **Make the project detail page's risk story coherent** — the tier, its change, and which model produced it, as one designed unit rather than loose spans. *Remaining.*
4. **Close two small gaps** on the PPAs list and the inspector form. *Remaining.*
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

### 3.2 PPAs list — ~2 hours

- **Counts on each filter option.** The sidebar maps `value`/`label` only.
- **A leading severity stripe per row**, using the solid ramp, so Critical rows are found without reading a column.

### 3.3 Inspector form — ~30 minutes

- **The file-input button is `file:h-10`** (40px), below the touch floor the rest of the form already meets with `h-12`.
- **Verify sunlight legibility** of the muted greys. This is the one claim from the original plan that the audit could not settle from the code.

---

## 4. Implementation (branch `feat/interface-redesign`, atomic commits)

| Phase | Work | Effort | Status |
|---|---|---|---|
| 1 | Design tokens | 1d | **shipped** |
| 2 | Login | 1d | **shipped** |
| 3 | Project detail — risk band, `score_basis`, sparkline, disclosure | 1d | remaining |
| 4 | PPAs — filter counts, severity stripe | 2h | remaining |
| 5 | Inspector — touch target, contrast check | 30m | remaining |

Roughly **1.5 days remaining**, against the 5–7 the first version assigned.

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
- **These screens are only honest against real data.** Every one is a different problem at 2,393 projects than at six placeholder rows, which is why this plan does not route through a mock-up tool.
