---
tags: [ml-pipeline, stage, level-1, headline-metrics]
status: active
created: 2026-08-08
updated: 2026-08-08
---

# Stage 6: train_meta_learner.py

The Level 1 model: a Multinomial Logistic Regression trained on three inputs per row — Random Forest's OOF probability, XGBoost's OOF probability, LSTM's OOF probability (never in-sample predictions — that would leak). Because a matching LSTM OOF prediction is the tightest constraint in the stack, only 1,124 of 3,612 train rows and 477 of 1,547 test rows survive into this stage.

## Current headline metrics (final run, post Phase 8 clamp, unrestricted hardware) — THE numbers to cite

Test set (n=477): accuracy 0.895, precision 0.879, recall 0.851, F1 0.865, AUC-ROC 0.962.

Risk tier distribution (test): Low 275, Medium 41, High 23, Critical 138 (thresholds: Low 0.0–0.3, Medium 0.3–0.7, High 0.7–0.9, Critical 0.9–1.0 — must match the manuscript exactly, defined in `probability_to_risk_tier()`).

## Revision history (why these numbers moved, in order)

0.832/0.803 (original) → 0.813/0.773 (DATE RELEASED proxy-date fix) → 0.811/0.767 (contractor features activated) → 0.811/0.754 (NTA/SEF folded in, LSTM zero-event drop fixed) → 0.873/0.842 (barangay-veto crosswalk fix, [[../02-Decisions/D04-Barangay-Veto-Crosswalk]]) → **0.895/0.851 (current, Phase 8 clamp, [[../02-Decisions/D03-Phase8-Clamp]])**. Every change reflects removing a real data defect, activating real signal, or a documented hyperparameter reduction — never tuning toward a target number. Notably, these numbers stayed roughly stable through the clamp fix despite a materially noisier LSTM base learner ([[Stage5-Train-LSTM]]) — the logistic regression appears to weight RF/XGBoost's cleaner signal more heavily, keeping the ensemble resilient.

## Source of truth

`ml-service/artifacts/meta_learner_metrics.json`, and the full methodology writeup in `MAAGAP_Model_Training_Testing_Methodology_Report.docx` at the project root.
