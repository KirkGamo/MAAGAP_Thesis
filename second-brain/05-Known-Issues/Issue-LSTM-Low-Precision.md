---
tags: [open-issue, ml-pipeline, level-0]
status: narrowed
created: 2026-08-08
updated: 2026-08-08
---

# Open Issue: LSTM Low Precision

The LSTM base learner ([[../03-ML-Pipeline/Stage5-Train-LSTM]]) is high-recall/low-precision on its own: test recall 0.894, precision 0.468 (final run). It's flagging RedFlag=1 very aggressively.

## Likely contributing factors

The training set's Phase 8-shifted composition (many rows are RedFlag=0 by construction — see [[Issue-Phase8-Clamp-Artifact]] — which may be pushing the class-weighted loss to over-correct toward the positive class elsewhere), and the inherently small, short (length ≤5) event history giving the model little to discriminate on.

## Why it hasn't broken the ensemble

The meta-learner's logistic regression appears to weight Random Forest/XGBoost's cleaner signal more heavily — Level 1 metrics (0.895 accuracy, 0.851 recall) stayed roughly stable despite this. Worth a sentence at defense if asked why the LSTM alone looks noisy; not currently a blocking problem, but also not something to claim is "resolved."


---

## Narrowed 2026-09-29 — coverage addressed, precision not

[[../02-Decisions/D21-Two-Learner-Fallback]] separated two problems that had been treated as one.

The **coverage** half is resolved. Only 668 of 2,393 ongoing projects could be scored, and the cause turned out not to be sequence scarcity at all — 19,327 sequences exist. Sequences are built by iterating the fund-transfer crosswalk, so monitoring rows it could not link were keyed `MON_ONLY_*` and never received one. A two-learner fallback now scores those rows, lifting coverage to 2,393 and recovering Objective 4.

The **precision** half stands. The LSTM's own test AUC is 0.7159, and on identical rows it adds only +0.0054 AUC to the ensemble while costing 0.0084 accuracy and 0.0065 F1. It is retained because Objective 1 specifies the three-learner architecture and it does improve ranking, but it remains the weakest learner in the stack by a wide margin.

A consequence worth tracking: 72% of scored projects now carry two-learner scores, so the LSTM influences a minority of live risk tiers.
