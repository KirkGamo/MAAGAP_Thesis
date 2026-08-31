---
tags: [decision, ml-pipeline, data-quality]
status: active
created: 2026-08-15
updated: 2026-08-31
---

# D14: Manual Project-Type Override Tier (DQ-7 v4)

## Context
D12's classifier fallback abstains below 0.7 confidence by design, leaving
251 monitoring rows (219 distinct names; 239 within the deduplicated
8,278-row pipeline population) permanently Unclassified -- no amount of
further modeling resolves these from the name string alone
([[../05-Known-Issues/Issue-Unclassified-Project-Type]]). Some are genuinely
ambiguous without PPDO's own records (bare "FA", "TPED", "MPB").

## Decision
Add a third, more authoritative tier ahead of both the keyword heuristic and
the classifier: an exact-match, hand-maintained
`project_type_manual_overrides.csv` (NAME OF PROJECT -> project_type),
applied with no confidence gating -- a human decision is not subject to a
statistical threshold. Paired with an auto-regenerated
`unclassified_project_review.csv` (gitignored -- a derived worklist, not a
source of truth), a ranked worklist (by row count) of every still-
Unclassified name plus the classifier's own below-threshold guess, so
filling in overrides is a ranked task rather than a blind search.
`project_type_source` gains a fourth value, "manual".

## Why
- Preserves D12's evidentiary-tier discipline (mirrors
  completion_date_is_proxy/is_clamped): every row's type is traceable to
  manual / keyword / classifier / unclassified, never silently blended.
- Ranked by n_rows so labeling time goes to the highest-impact names first
  -- the top name alone accounts for 4 of 251 rows.
- Deliberately NOT auto-applying the classifier's below-threshold guess:
  that would silently undo D12's abstention design for exactly the rows it
  was built to protect.

## Status
Override file is currently empty -- mechanism is wired in and tested
end-to-end, but no rows have been hand-labeled yet. The test (2026-08-31)
temporarily overrode two names, "Box Culvert" (Infrastructure) and "TPED"
(Non-Infrastructure), and confirmed all four expected behaviours: 7 rows
took the labels, `project_type_source` reported "manual" for exactly those
7, both names dropped out of the review worklist (219 -> 217 names,
251 -> 244 rows), and Unclassified fell 2.9% -> 2.8%. The overrides file
was then reverted to empty and preprocess re-run, so the committed state is
the true 219-name / 251-row baseline. Per HANDOFF: do not retrain
or reseed after labeling more of these -- that changes the population and
is a separate approval.
