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
**Worked through by Kirk on 2026-08-31**: 209 distinct names labeled, clearing
**248 of the 251** Unclassified rows. Unclassified is now **3 rows (0.0%)** --
and those 3 are unlabelable in principle, not merely unlabeled: one name is a
stray Excel serial ("45701") and two are blank. `project_type_source` breakdown
is now keyword 7,110 / classifier 1,423 / manual 248 / unclassified 3.

Verification of that labeling pass found and fixed three classes of problem:

1. **Formatting (fixed mechanically)**: 215 of 217 lines carried a trailing
   comma, creating a phantom third field. pandas shifted every column -- the
   name became the index and `project_type` parsed as all-NaN -- so the file
   would have applied ZERO overrides while logging only "216 rows skipped".
   A silent no-op, not a crash.
2. **26 entries contradicting the established convention (flipped)**: labels
   were checked against the 7,110 already-keyword-classified rows, which are
   near-unanimous -- water system 231/231, dumpsite 52/52, slope protection
   10/10, riprap 8/8, electrification 5/5, culvert 3/3 all Infrastructure.
   The overrides had marked these Non-Infrastructure, apparently keying on the
   funding mechanism (FA-/TF-/"Purchase of materials") rather than the
   deliverable. The existing population does not do that: 130 of 466
   FA/TF-prefixed rows are Infrastructure. Since project_type sets T_standard
   (365 vs 182 days), keying on funding mechanism would mis-set the delay
   threshold and put contradictions inside the training data.
3. **2 silent conflicts (resolved to Infrastructure)**: "Slope Protection" vs
   "Slope protection" and "Well Development" vs "Well development" differ only
   in case, which normalization folds -- so they collapsed to one key with
   contradictory labels and last-write-wins silently.

Final label balance: 137 Non-Infrastructure / 79 Infrastructure across 216
entries. Post-fix verification is clean on all seven checks (parse integrity,
invalid values, conflicting keys, no-op entries, accidental overrides of
already-classified rows, coverage, convention contradictions).

**Known gap this exposed**: `load_project_type_overrides()` resolves duplicate
normalized keys by last-write-wins rather than failing loudly. Worth hardening
so a future conflicting pair is rejected rather than silently decided.

Per HANDOFF: labeling changed the population, so retraining and reseeding
against it is a SEPARATE approval and has not been done. `data/ready` and the
trained artifacts still reflect the pre-override 5,761-row population;
regenerating is expected to lift it to roughly 5,886 (125 of the newly-typed
rows already have a resolved completion date).
