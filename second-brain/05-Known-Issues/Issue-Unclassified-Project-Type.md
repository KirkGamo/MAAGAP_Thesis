---
tags: [open-issue, ml-pipeline, target-variable]
status: narrowed
created: 2026-08-08
updated: 2026-08-15
---

# Open Issue: Unclassified Project Type (narrowed 2026-08-15)

Previously 19.1% of all monitoring rows (1,674 of 8,784) had `project_type = "Unclassified"` and could **never** be labeled — `T_standard` is undefined without a resolved Infrastructure/Non-Infrastructure category, so `RedFlag` stays NaN regardless of completion-date evidence.

**Largely resolved by [[../02-Decisions/D12-Project-Type-Classifier]]** (the supervised TF-IDF + logistic-regression fallback the original Data Audit Report Section 6 Step 5 called for): the residual Unclassified rate is now **2.9%** of raw monitoring rows (251 of 8,784; 239 within the deduplicated 8,278-row pipeline population). The recovery lifted the labeled population 4,804 → **5,761 rows (+19.9%)**, with every classifier-typed row marked `project_type_source = "classifier"` for downstream discounting or exclusion.

## What remains open

- The 251 residual rows are those the classifier could not call at ≥0.7 confidence — by design they stay Unclassified rather than being guessed (`project_type` feeds `T_standard` feeds `RedFlag`). Genuinely ambiguous names (bare "FA", "TPED", "School Facilities") likely need PPDO's own records, not better modeling.
- **Largely cleared on 2026-08-31** via [[../02-Decisions/D14-Manual-Project-Type-Overrides]]: Kirk labeled 209 distinct names, clearing **248 of 251** rows. Unclassified is now **3 rows (0.0%)**, and those 3 are unlabelable in principle (a stray Excel serial "45701" plus two blank names) rather than merely awaiting effort. Verification flipped 26 entries that contradicted the established convention (water system 231/231, dumpsite 52/52, slope protection 10/10, riprap 8/8, electrification 5/5, culvert 3/3 are all Infrastructure in the keyword-classified population) and resolved 2 case-only conflicts.
- The worklist is long-tailed, which caps the payoff from any single decision: 219 distinct names for 251 rows means most names appear once, and the highest-frequency name accounts for only 4 rows. Clearing the entire list would move roughly 3% of the monitoring population.
- Classifier-typed rows (953 of the labeled population, 16.5%) carry a measured ~1.1% error rate on held-out evaluation (98.9% accuracy at the threshold) — a small, quantified label-noise source that should be caveated in the methodology report alongside the proxy-date caveats.
- Retraining on the enlarged population is DONE (2026-08-15, HANDOFF Section 2: meta-learner 0.903 accuracy / 0.967 AUC-ROC on n=608), and Supabase was reseeded from it. Any *further* clearing via D14 changes the population again, and per the established pattern that is a separate approval — not an automatic retrain trigger.
