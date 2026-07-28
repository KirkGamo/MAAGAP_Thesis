# MAAGAP Frontend — Design Consistency Audit

**Scope:** whole app, general polish pass. **Method:** direct code audit (grep across `frontend/src/`) rather than visual screenshots — every finding below is a file:line citation, not an impression, so it can be fixed mechanically.

## Overall impression

The instinct that it "looks off and inconsistent" is correct, and the cause is precise, not vague: two card systems (shadcn + Tremor) are used interchangeably page-to-page, three different "dark text" gray families coexist, and the brand color token is applied to headings and chrome but skipped by form controls. None of this is random — it's what happens when a UI is built feature-by-feature over many phases without a shared component contract. The good news: the actual layout discipline (spacing scale, page-heading pattern, body-copy color) is already solid, so this is a token/component-consolidation pass, not a redesign.

## Consistency findings

| Element | Issue | Recommendation |
|---|---|---|
| Card container | Overview + Models use Tremor's `rounded-xl border p-6 shadow-md`; PPAs, Schedule, Inspectors, Reports, and the whole Inspector portal use shadcn's `rounded-lg ... shadow-sm`. Same visual role, two different radii and shadow weights, split roughly down the middle of the app. | Pick one. Tremor's `rounded-xl/shadow-md` was already a deliberate fix for cards looking "flush" against `--color-brand-surface` (see `tremor/card.tsx` code comment) — apply that same fix to `ui/card.tsx` instead of maintaining two Card components with different physics. |
| "Dark text" color | Three families coexist: `text-brand-navy` (Manager brand token), `text-slate-900/950` (shadcn defaults, tables, Inspector headings), `text-gray-900` (Tremor's `Metric` + Overview's "Next steps" card). Gray and slate are visually near-identical but are different Tailwind palettes — not even a deliberate two-tone system. | Standardize on `text-brand-navy` for headings/emphasis and `text-slate-*` for body/secondary everywhere. Purge every `text-gray-*` usage (2 files: `tremor/metric.tsx`, `manager/page.tsx`). |
| Form control borders | Every native `<select>` in the app (PPA filters, Reports filters, Schedule editor, manual-entry form, report form) hardcodes `border-slate-200`, while every surrounding Card/header/input border uses the brand-tinted `border-brand-navy/10`. | Global find/replace `border-slate-200` → `border-brand-navy/10` on the ~6 files listed in the audit. One-line diffs, immediate visual unification. |
| Inspector portal vs Manager portal | Inspector uses `bg-slate-50` (canvas), `border-slate-200` (header), `text-xl font-semibold text-slate-900` (page heading). Manager uses `bg-brand-surface` (`#f2f8fd`, a bluer off-white), `border-brand-navy/10`, `text-2xl font-semibold text-brand-navy`. Two portals of the same product, visibly different palettes. | Bring Inspector onto the same tokens. Keep the smaller `text-xl` (it's mobile-first, that's a legitimate scale choice) but switch the color to `text-brand-navy` and the canvas/border to `bg-brand-surface`/`border-brand-navy/10`. |
| Font family | `globals.css` defines a Geist `--font-sans` token in the `@theme` block, but `body` is hardcoded to `Arial, Helvetica, sans-serif` one line below — the whole app silently renders in system Arial instead of the font that's actually configured. | One-line fix: apply `var(--font-sans)` to `body`. Highest visual impact relative to effort of anything in this list — every page's typography changes at once. |
| Loading skeletons | 3 of ~7 Manager routes (Inspectors, Reports, Models) fall back to the generic `manager/loading.tsx`, which is documented as matching only Overview's specific layout (4 tier cards + 2 charts) — those three routes will flash a visibly wrong skeleton shape before real content paints. PPAs and Schedule have purpose-built, accurate skeletons. | Give Inspectors/Reports/Models their own `loading.tsx` mirroring each page's real structure, same pattern already used for `ppas/loading.tsx`. |
| Dead code | `manager/backlog/*` (superseded by `manager/ppas` back in Phase 12, per its own code comment) is unreferenced by any link/import but still exists, still using the old `border-slate-200` pattern. Not user-visible, but a maintenance/consistency trap if anyone edits it thinking it's live. | Delete `manager/backlog/` outright. |

## What's already working well

- Every Manager-portal page heading is byte-for-byte identical: `text-2xl font-semibold text-brand-navy` (8 for 8 pages checked). This is the strongest consistency pattern in the app — don't touch it, extend it to Inspector.
- Page-level spacing (`flex flex-col gap-6` wrappers, `gap-4` KPI grids, `gap-3` filter bars, `text-sm text-slate-500` body copy under headings) is consistent across every page checked. The spacing scale is not the problem here, even though it might feel like part of the "off" impression.
- The brand palette itself (`--color-brand-navy/blue/sky/cyan` + surface, all logo-derived with provenance comments in `globals.css`) is disciplined and well-documented — the problem is inconsistent *application*, not a messy palette.
- Risk-tier and status badge colors (`Badge`'s semantic variants) correctly use meaningful color (emerald/amber/orange/red/blue) rather than brand color, which is the right call for status indicators.

## Priority recommendations

1. **Unify the Card component** (Tremor `rounded-xl/shadow-md` wins) and **apply the Geist font** — these two changes alone touch nearly every screen in the app and would visibly resolve most of the "inconsistent" feeling in under an hour of work, without touching any page's actual layout or content.
2. **Purge `text-gray-*` and `border-slate-200`** in favor of the brand tokens (`text-brand-navy`/`text-slate-500` for text, `border-brand-navy/10` for borders) — mechanical find/replace across ~8 files, no layout risk.
3. **Bring the Inspector portal onto the Manager portal's tokens** (`bg-brand-surface`, `border-brand-navy/10`, `text-brand-navy` headings) — matters most before a defense demo, since switching between portals live is exactly when a palette mismatch reads as unpolished.
4. Lower priority, do when convenient: purpose-built loading skeletons for Inspectors/Reports/Models, and delete the dead `manager/backlog/` route.

Everything above is a token/class-level change — no component API changes, no new dependencies, nothing that risks the working functionality from Phases 1-14.
