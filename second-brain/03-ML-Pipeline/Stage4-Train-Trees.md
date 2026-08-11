---
tags: [ml-pipeline, stage, level-0]
status: active
created: 2026-08-08
updated: 2026-08-08
---

# Stage 4: train_trees.py

Trains the two tree-based Level 0 base learners: Random Forest (300 trees, max depth 8, min_samples_leaf 3, class_weight="balanced") and XGBoost (300 estimators, max depth 4, learning rate 0.05, subsample/colsample_bytree 0.8, scale_pos_weight from the train split's class ratio). Both via the same 5-fold stratified OOF protocol ([[../02-Decisions/D07-No-Third-Validation-Split]]).

Trained on 130 features (down from 341 engineered columns after a zero-variance filter). `EXCLUDE_COLS` deliberately drops anything target-derived (RedFlag, T_actual_days, T_standard_days, NegativeSlippage_pct, extension_approved) and any provenance/housekeeping flag (`completion_date_is_proxy`, `completion_date_is_clamped`, `date_released_is_proxy`, `D_start`, `source_sheet`) — including these would leak the label or add noise, not signal.

## Current metrics (final run, post Phase 8 clamp, unrestricted hardware)

RF test: accuracy 0.841, recall 0.859, AUC-ROC 0.905. XGBoost test: accuracy 0.921, recall 0.905, AUC-ROC 0.975. Both improved over the barangay-veto-only revision (RF 0.820→0.841, XGB 0.907→0.921) — plausibly the ~1,026 additional resolved training rows from the clamp, though part of that subset's RedFlag=0 labels are a construction artifact, not observed evidence (see [[../05-Known-Issues/Issue-Phase8-Clamp-Artifact]]).

## Logging worth reading, not just skimming

This script logs a "PHASE 6/7 PROXY-DATE CAVEAT" and a "PHASE 8 CLAMP CAVEAT" warning every run, breaking out the direct-vs-proxy and clamped-vs-not RedFlag rates — read it after every re-run, it's the fastest way to notice if the population composition shifted unexpectedly.
