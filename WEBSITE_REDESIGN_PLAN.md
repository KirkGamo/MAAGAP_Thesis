# MAAGAP — Website Redesign Plan

_Drafted 2026-10-05. Scope: the four surfaces the September 2026 series never covered — the login page (`frontend/src/app/login/`), the PPAs list and project detail pages (`frontend/src/app/manager/ppas/`), and the inspector-facing pages (`frontend/src/app/inspector/`) — plus one cross-cutting extension to the design tokens in `frontend/src/app/globals.css`. Fifth in the series after the dashboard, schedule, inspectors and reporting-loop plans. **Inherits their single-viewport and progressive-disclosure doctrine rather than reopening it.**_

---

## 1. Objectives

1. **Make the brand palette usable.** Measured against white, two of MAAGAP's four brand colours fail WCAG AA: Sky `#099ED7` is 3.05:1 (fails body text) and Cyan `#6AD9F7` is 1.63:1 (fails everything). They survive today only as hairline borders and small accents, so the app defaults to navy-on-white — the only combination that passes. **This is the measurable cause of "the site looks plain", and it has a correct answer:** on navy, Cyan is 8.46:1 and Sky 4.52:1. Introduce navy as a *surface*, not only as a text colour.
2. **Give the design system the means to express hierarchy.** It currently has eight brand colours and nothing else — no elevation scale, no semantic scale, no surface roles — so every block is a white card with the same border and radius, and nothing reads as more important than anything else.
3. **Make the project detail page show the model's reasoning instead of describing it.** It is the page that answers the question the thesis exists to answer, and it currently carries **10 prose blocks to 2 visual elements**. SHAP feature contributions — signed magnitudes, which *are* a chart — render as a text list.
4. **Give the login page an identity.** A `max-w-sm` form card on `bg-slate-50` could belong to any product. `public/maagap-logo.png` is committed and referenced nowhere on it.
5. **Design the inspector pages for the conditions they are used in** — one-handed, outdoors, on a phone, on a connection that drops — rather than as narrow desktop forms.
6. **Disturb nothing in the four September tabs** beyond the new tokens. Their one-screen contract at 1366×768 is a constraint on this work, not a target for it.

---

## 2. Current State

### 2.1 The palette, measured

| Token | Hex | On white | AA body (4.5:1) | On navy |
|---|---|---|---|---|
| `--color-brand-navy` | `#242467` | 13.79:1 | pass | — |
| `--color-brand-blue` | `#234FA4` | 7.70:1 | pass | — |
| `--color-brand-sky` | `#099ED7` | **3.05:1** | **fail** | 4.52:1 pass |
| `--color-brand-cyan` | `#6AD9F7` | **1.63:1** | **fail** | 8.46:1 pass |

Computed from the committed values in `globals.css`. The palette was sampled honestly from the logo; the problem is the canvas it was given, not the sampling.

### 2.2 What exists

- **Tailwind v4, CSS-native.** The theme lives in an `@theme` block in `globals.css`; there is no `tailwind.config.ts` in this scaffold. New tokens are added the same way the brand colours already were.
- **Light-only by decision.** `color-scheme: light` is forced on `:root` (Phase 20) because no dark palette was ever designed. Out of scope here.
- **15 components**: `ui/*` (badge, button, card, input, label, sheet, skeleton, table, tabs) and `tremor/*` (bar-chart, card, metric, notification-bell, tracker, user-menu), plus `error-panel`.
- **Login**: 115 lines. `max-w-sm` Card centred on `bg-slate-50`. No logo, no system name, no statement of purpose or office.
- **Project detail**: 414 lines, 10 prose/caption blocks against 2 visual elements.
- **Inspector pages**: 400 lines across six files — the smallest surface in the app and the one used in the worst conditions.

---

## 3. Target: the design system first

Everything else consumes this, so it ships first.

**Surface roles**, so border/radius/shadow can be applied *by role* rather than uniformly:

| Token | Use |
|---|---|
| `--surface-base` | page ground |
| `--surface-raised` | the one card per view that is primary |
| `--surface-inverse` | navy — app shell, login panel, header bands |
| `--surface-sunk` | wells, code, secondary panels |

**A risk ramp separate from the brand.** Risk tier is the most important encoding in this product and currently borrows generic badge colours. Four steps (Low/Medium/High/Critical) with their own hues, **always paired with a non-colour cue** — the shape-plus-colour encoding already proven on the schedule markers (F3). Tier must never be carried by hue alone, anywhere.

**A type scale.** Geist is one good face doing one job at one size. Define display / heading / body / caption / numeric roles, with `font-variant-numeric: tabular-nums` wherever figures align in columns — which in this app is most places.

**Density tokens.** The manager tabs must stay inside one viewport; the inspector pages are read at arm's length. These are different spacing systems and should be named as such.

---

## 4. Page Work

### 4.1 Login (`app/login/`)

- **Two-panel layout.** Navy panel: logo, full system name, one line naming the office and what the system does. White panel: the form. At phone width the navy panel becomes a header band rather than vanishing.
- **Use `public/maagap-logo.png`.** It is already committed.
- **Name both roles.** Managers and inspectors sign in here and land in different places.
- **Do not add**: stock construction photography (decoration standing in for identity), or demo credentials printed on the page (a security habit a panel will notice).

### 4.2 Project detail (`app/manager/ppas/[projectId]/`)

- **SHAP as a diverging bar chart.** Bars left of a centre axis reduce risk, right increase it, labelled with the plain-English feature names the page already computes. *This single change does more for the page than everything else combined.*
- **A risk header band** carrying tier, probability, Δ since last score, and `score_basis`, designed as one unit rather than three sibling spans.
- **Score history as a sparkline**, with an emphasised endpoint. The series exists now that R4 persists `project_score_history`.
- **Monitoring reports as a timeline** — dated entries, status chips, photo thumbnails — rather than a table.
- **Demote the caveats; do not delete them.** The notes explaining that a completed project can still carry a high tier, and that a score reflects elapsed time as well as observation, are correct and unusual in a student system. They move behind a *How to read this* disclosure and into field-level tooltips, each keeping a visible affordance.

### 4.3 PPAs list (`app/manager/ppas/`)

- **Filter chips** for tier, municipality and status, with counts — the three questions a planning officer arrives with.
- **A leading severity stripe per row**, so Critical rows are found without reading a column.
- **Default the sort to risk.** 93.8% of the portfolio is Low; a list opening on a wall of Low badges hides the 100 projects that matter. State what a filter is hiding whenever one is active.

### 4.4 Inspector pages (`app/inspector/`)

- **44px minimum touch targets**, controls within thumb reach, submit at the bottom rather than after a scroll.
- **Photo capture as a primary action**, not a `Choose Files` input. It is the main thing an inspector contributes from site.
- **Unambiguous submission state.** A report that may have failed on a bad connection needs confirmation the inspector can trust, because they cannot check from the field.
- **High-contrast for sunlight**, which rules out the light-grey-on-white treatment used across the manager views.

---

## 5. Implementation Phases (branch `feat/interface-redesign`, atomic commits)

| Phase | Work | Effort | Rationale for the position |
|---|---|---|---|
| 1 | Design tokens: surface roles, risk ramp, type scale, density | 1d | everything else consumes it |
| 2 | Login | 0.5d | smallest surface; proves or kills the navy-surface direction cheaply |
| 3 | Project detail — SHAP chart first | 2d | highest value; carries the defence demo |
| 4 | PPAs list | 1d | the route into phase 3 |
| 5 | Inspector mobile | 1d | different device, different rules |

Phase 2 precedes phase 3 deliberately: half a day on the login page settles whether navy-as-surface works before two days are committed to the page that depends on it.

---

## 6. Verification

1. **Every brand colour used for text passes AA against its own surface.** For Sky and Cyan this means they appear on navy or not at all. Re-measure, do not assume.
2. **The project page's visual-to-prose ratio inverts** from today's 2:10, with no caveat deleted.
3. **A stranger can name the office and the system's purpose from the login screen alone**, unaided.
4. **The four September tabs still fit one screen at 1366×768**, measured the way they were built: full-page screenshot height equals viewport height.
5. **Risk tier is never carried by hue alone**, on any surface.

---

## 7. Risks & Gotchas (read before coding)

- **The token change is cross-cutting.** Phase 1 touches every page, including the four that must not start scrolling. Verify the September tabs after phase 1, not at the end — if a new token forces a tab to scroll, the token is wrong, not the tab.
- **Do not reopen the September layouts.** Those tabs inherit the new tokens and nothing else. Their single-viewport contract is a constraint on this work.
- **The caveats are a feature.** The project detail page reads as text-heavy because it is unusually honest about what the model can and cannot claim. Progressive disclosure is the fix; cutting them for visual tidiness trades the system's integrity for a cleaner screenshot.
- **Light-only is deliberate.** `color-scheme: light` is forced for a recorded reason (native form controls rendering white-on-white under a dark OS preference). Adding dark mode is a separate decision, not a side effect of retokenising.
- **SHAP values are signed and asymmetric.** The diverging chart must place zero at a true centre and scale both directions against the same magnitude, or the visual will overstate whichever side happens to be larger. Label a value the chart actually reaches.
- **These screens are only honest against real data.** Every one of them is a different problem at 2,393 projects than at six placeholder rows — which is why this plan does not route through a mock-up tool.
