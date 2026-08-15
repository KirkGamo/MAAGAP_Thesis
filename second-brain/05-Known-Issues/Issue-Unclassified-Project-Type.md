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
- Classifier-typed rows (953 of the labeled population, 16.5%) carry a measured ~1.1% error rate on held-out evaluation (98.9% accuracy at the threshold) — a small, quantified label-noise source that should be caveated in the methodology report alongside the proxy-date caveats.
- Model retraining on the enlarged population has not yet happened (HANDOFF Section 2's staleness note applies).
