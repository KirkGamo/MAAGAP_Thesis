---
tags: [open-issue, ml-pipeline, level-0]
status: active
created: 2026-08-08
updated: 2026-08-08
---

# Open Issue: LSTM Low Precision

The LSTM base learner ([[../03-ML-Pipeline/Stage5-Train-LSTM]]) is high-recall/low-precision on its own: test recall 0.894, precision 0.468 (final run). It's flagging RedFlag=1 very aggressively.

## Likely contributing factors

The training set's Phase 8-shifted composition (many rows are RedFlag=0 by construction — see [[Issue-Phase8-Clamp-Artifact]] — which may be pushing the class-weighted loss to over-correct toward the positive class elsewhere), and the inherently small, short (length ≤5) event history giving the model little to discriminate on.

## Why it hasn't broken the ensemble

The meta-learner's logistic regression appears to weight Random Forest/XGBoost's cleaner signal more heavily — Level 1 metrics (0.895 accuracy, 0.851 recall) stayed roughly stable despite this. Worth a sentence at defense if asked why the LSTM alone looks noisy; not currently a blocking problem, but also not something to claim is "resolved."
