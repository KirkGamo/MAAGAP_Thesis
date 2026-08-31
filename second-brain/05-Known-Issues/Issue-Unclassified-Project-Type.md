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
- **A route to clearing them now exists** ([[../02-Decisions/D14-Manual-Project-Type-Overrides]], 2026-08-31): `reference/project_type_manual_overrides.csv` is an authoritative hand-maintained tier applied ahead of both the heuristic and the classifier, with no confidence gating, and `reference/unclassified_project_review.csv` is regenerated on every preprocess run as a ranked worklist of the 219 distinct names covering these 251 rows (with each name's row count and the classifier's below-threshold best guess). **How many Kirk actually clears is not yet known — the override file is still empty**; this note should be updated with the real cleared/remaining split once he has worked the list.
- The worklist is long-tailed, which caps the payoff from any single decision: 219 distinct names for 251 rows means most names appear once, and the highest-frequency name accounts for only 4 rows. Clearing the entire list would move roughly 3% of the monitoring population.
- Classifier-typed rows (953 of the labeled population, 16.5%) carry a measured ~1.1% error rate on held-out evaluation (98.9% accuracy at the threshold) — a small, quantified label-noise source that should be caveated in the methodology report alongside the proxy-date caveats.
- Retraining on the enlarged population is DONE (2026-08-15, HANDOFF Section 2: meta-learner 0.903 accuracy / 0.967 AUC-ROC on n=608), and Supabase was reseeded from it. Any *further* clearing via D14 changes the population again, and per the established pattern that is a separate approval — not an automatic retrain trigger.
