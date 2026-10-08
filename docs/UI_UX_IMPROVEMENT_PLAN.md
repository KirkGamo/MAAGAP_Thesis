# MAAGAP — UI/UX Improvement Plan

_Drafted 2026-10-08. Scope: visual language, plain-language copy, information density, and interaction feedback across the manager and inspector surfaces._

---

## 0. How this was measured

Every figure below was taken from the running application, not from reading source. That matters here because this repo has already produced one plan that was written from greps and was wrong about three of its five workstreams (`WEBSITE_REDESIGN_PLAN.md` §0).

Latency numbers were taken from a **production build** (`next start`), not the dev server, after an initial dev measurement proved misleadingly close — Turbopack's on-demand compilation was not the cause, so these numbers are real.

---

## 1. What the audit found

### 1.1 Interaction feedback — the most severe problem, and not a cosmetic one

**12 of 25 client components navigate or mutate with no pending state.** The split is not random:

| | Pending feedback |
|---|---|
| Mutations — forms, dialogs, deploy, invite, re-score | **13 of 13 have it** |
| Navigations — filters, tabs, toggles, selections | **0 of 12 have it** |

Someone handled everything that obviously awaits a server, and missed the fact that in the App Router a URL change is *also* a server round-trip. Measured on a production build, click to settled, with nothing on screen in between:

| Action | Latency |
|---|---|
| PPAs → "Hide Controls" | **2,321 ms** |
| Schedule → change day tab | 902 ms |
| Reports → select a report | 897 ms |

Nothing moves for roughly one second — nearly two and a half on the PPAs toggle. The usual threshold for "this needs an indicator" is 100 ms, and for "the user suspects it is broken" about one second. Every one of these is past the first and at or past the second.

**`loading.tsx` does not help here.** It fires on route-segment changes, not on search-param changes within the same route, so none of these interactions can reach the skeletons that already exist.

**One of them is an architectural fault, not a missing spinner.** `?controls=hidden` is a pure layout flag — `{!controlsHidden && <PpaFilterSidebar/>}`. It changes no data. Yet toggling it re-runs the entire server render, including the three-page facet pagination over 2,393 projects. **It spends 2.3 seconds and three database queries to hide a sidebar.** A spinner would make that honest; it would not make it right.

### 1.2 Icons and visual language

**20 distinct icons in the whole application, and every single main page file contains none.**

Icons exist only in the sidebar, the top chrome, and a handful of controls. The content regions — where a user actually works — are pure text and numbers. The `public/` folder holds the logo, the Iloilo points map, and Next.js's default sample SVGs.

Per surface: manager 15 distinct icons (all in chrome or controls), inspector 2, login 2, shared components 5.

### 1.3 Technical language

Measured by scanning rendered text, with disclosures expanded:

| Page | Words | Prose blocks (12+ words) | Longest block | Jargon terms |
|---|---|---|---|---|
| **Models** | 549 | 7 | **80 words** | **36** |
| PPAs | 830 | 1 | 24 | 1 (`RedFlag`) |
| Inspectors | 190 | 3 | 47 | 2 |
| Overview | 155 | 2 | 22 | 2 |
| Schedule | 141 | 0 | — | 3 |
| Reports | 68 | 0 | — | 1 |

The problem is **concentrated, not diffuse**. Models carries 36 of the 45 flagged terms; the other five pages average two each. PPAs' 830 words are table data (project names), not prose.

This reframes the work: four of the six pages do not have a language problem. Models does, and a handful of specific terms leak elsewhere — `P(RedFlag)` as a column header, `solver` and `cluster` on Schedule, `optimizer slot` on Inspectors, `re-score` on Reports.

### 1.4 Information density

Already addressed on the pages that needed it. Four tabs hold a verified one-screen contract at 1366×768; Models went from 2.48 screens to one in `d67cfd5`. The remaining density issue is not volume but **undifferentiated weight** — a page of equal-sized cards where nothing signals what to read first.

---

## 2. Principles for this pass

1. **Feedback before decoration.** A 900 ms dead click is a worse experience than a missing icon. Workstream A ships first.
2. **Icons must carry meaning, not fill space.** An icon beside every label is noise. Icons earn their place where they aid scanning (list rows, status, nav), encode a state redundantly with colour, or replace a word in a tight control.
3. **Plain language is not dumbed-down language.** The audience is PPDO planning officers and a CS panel. The fix is a plain sentence *beside* the precise term, never instead of it — the precision is the thesis's defensibility. The existing Models glossary is the pattern to extend.
4. **Never cut a caveat for tidiness.** The honesty of the Models and project pages about what the models cannot claim is unusual in a student system and is an asset at defence. Disclosure, not deletion.
5. **The one-screen contract holds.** Confirmed by the owner on 2026-10-08. Icons and copy must fit the existing height budgets.

---

## 3. Workstreams

### A. Interaction feedback — ~1.5 days · **do first**

**A1. A shared navigation-pending primitive.** All 12 components share one shape: build a `useUrlState()` hook wrapping `router.push` in `useTransition`, returning `isPending`. One hook, twelve call sites.

**A2. Apply visible pending state per control type.** A filter checkbox dims and shows a spinner in place of its count; a tab shows a progress underline; a list row shows a selected-but-loading state; a toggle disables and labels itself "Hiding…". The content region gets a subtle opacity drop while stale, so the *whole* affected area reads as updating, not just the control.

**A3. Fix the PPAs controls toggle properly.** Make it client-side state rather than a URL round-trip, or keep the URL for linkability but render the sidebar behind a CSS toggle so no refetch occurs. Target: under 100 ms, zero queries. *This is the single highest-value item in the plan.*

**A4. Route-level transitions.** Verify the six `loading.tsx` skeletons actually appear on sidebar navigation, and that they match the layout they replace rather than being generic boxes.

**A5. Optimistic UI where the result is predictable.** Day-tab and report selection can render the new selection immediately while content loads.

### B. Visual language — ~2 days

**B1. Page identity icons.** One icon per page beside the `PageHeader` title, reusing the sidebar's existing set so nav and header agree. Cheap, and it makes six pages instantly distinguishable.

**B2. Icons where they aid scanning, not everywhere.** Specifically: list rows on Reports and the inspector's route; empty states; the Schedule agenda's inspector groups; status and capacity chips. Each one must survive the question *"what does removing this lose?"*

**B3. Empty-state illustration.** A single reusable `EmptyState` with icon, heading, one line, and an action. Currently empty states are bare sentences of varying copy.

**B4. Charts where a number is currently prose.** The Overview tier counts, the Inspectors weekly load, and the Models population split are all small-multiple candidates. Tremor is already a dependency.

**B5. Photographic evidence on report detail.** Inspector photos exist and are signed per render; they deserve a proper thumbnail grid with a lightbox rather than a strip.

### C. Plain language — ~1 day

**C1. Extend the glossary pattern beyond Models.** The term stays; a plain gloss sits beside it. `P(RedFlag)` is the clearest offender — a column header no PPDO officer can read.

**C2. Renaming — decided 2026-10-08: the terms stay.** `P(RedFlag)`, `optimizer slot`, `re-score` and `solver` keep their names. They appear in the manuscript, and a UI that calls something different from Chapter 3 costs more at a defence than it saves at a desk.

This makes C1 and C4 carry the whole workstream: the precise term stays on screen and a plain gloss sits beside it, which is the pattern the Models glossary already uses. *Explain in place, do not rename.*

**C3. A plain-language summary line per page**, under the title, in the user's terms rather than the system's.

**C4. Term tooltips on first use**, not on every occurrence.

### D. Structure — ~0.5 days

**D1. Visual hierarchy within pages.** Give the primary card more weight than its neighbours; the design tokens for this shipped in `22b9a5b` and are barely used.

**D2. Group the Overview's KPI strip** into labelled clusters rather than a flat row.

---

## 4. Verification

Each item must be demonstrated, not asserted:

1. **Every interactive control shows feedback within 100 ms of click.** Measured the same way §1.1 was, on a production build. This is the plan's headline number and must be re-measured, not assumed.
2. **The PPAs controls toggle issues zero database queries.**
3. **No page regresses its one-screen contract at 1366×768**, and no page gains horizontal overflow at 1868/1493/1366/1280/1024/390.
4. **Contrast stays at 0 styles below AA**; new icons are not the sole carrier of any meaning.
5. **Explanation coverage, not jargon count.** The original metric assumed the terms would be renamed; the 2026-10-08 decision was that they stay, so a count of terms present reads identically before and after and cannot tell you whether the work succeeded. The metric is now *what share of the technical terms shown on a page have an explanation reachable from that page* — measured at **12/12 (100%)**, against the term count which is, correctly, unchanged.
6. **60 tests still pass**, plus new tests for the pending-state hook.

---

## 5. Risks and gotchas

- **A spinner can hide a real performance bug.** A3 exists because the honest fix for the 2.3 s toggle is to stop doing the work, not to narrate it. Add feedback *and* remove the cause.
- **Icons are a contrast surface too.** A 16px glyph at `--ink-faint` on white passes AA for text, but non-text contrast is a separate 3:1 requirement against adjacent colour.
- **Any new full-table read needs explicit pagination.** Three defects in this codebase have come from PostgREST's silent 1,000-row cap. B4's charts will want aggregates — page them.
- **Renaming terms touches the manuscript.** Decided 2026-10-08: no renames. Glosses go beside the terms, never in place of them — the precision is the thesis's defensibility.
- **These screens are only honest against real data.** Every one is a different problem at 2,393 projects than at six placeholder rows.
- **Open the component before claiming what it does.** The lesson from `WEBSITE_REDESIGN_PLAN.md` §0, and the reason §1 is numbers rather than impressions.

---

## 6. Suggested order

| Phase | Work | Effort | Why here |
|---|---|---|---|
| 1 | A1–A3 interaction feedback + the PPAs toggle fix | 1 day | The only item users currently experience as the system being broken |
| 2 | A4–A5, D1–D2 | 0.5 day | Finishes the responsiveness story |
| 3 | B1–B3 icons and empty states | 1 day | Highest visual return per hour |
| 4 | C1, C3, C4 plain language | 1 day | C2 decided: no renames, so gloss in place |
| 5 | B4–B5 charts and photo grid | 1 day | Largest, least urgent |

**Roughly 4.5 days.** Phase 1 alone addresses the complaint most likely to be raised in an ISO 25010 session, since "the system was easy to operate and control" (US5) and "the system behaved consistently" (RL1) are both rated after a task walkthrough in which every filter click currently appears to do nothing for a second.
