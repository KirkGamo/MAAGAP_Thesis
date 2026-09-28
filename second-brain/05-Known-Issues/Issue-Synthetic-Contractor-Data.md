---
tags: [open-issue, data-availability]
status: resolved
created: 2026-08-08
updated: 2026-08-08
---

# Open Issue: Synthetic Contractor Data

Contractor features (`historical_delay_rate`, `reliability_score`, `contractor_spec_*`) are active in the feature set, but every value comes from a 150-row synthetic placeholder table ([[../03-ML-Pipeline/Stage2-Synthetic-Data]]) with no real linkage to actual PPDO contractors or PhilGEPS procurement records.

## Why this matters

This is Chapter 1's declared Data Availability limitation, not a bug. These features should be read as exercising the join/feature mechanics — proving the pipeline can incorporate contractor-level signal if it existed — not as real contractor-performance evidence in any current metric.

## What would resolve it

Real contractor-project linkage data. Flagged as a natural next step in [[HANDOFF]].


---

## Resolved 2026-09-29 — by removal, not acquisition

PPDO confirmed it does not hold contractor performance records: no register of delivery reliability or historical delay rates exists, and no alternative source was available. This issue could therefore never be closed the way it was written, by obtaining real data.

It is closed instead by **removing the synthetic features entirely** — see [[../02-Decisions/D20-Drop-Synthetic-Contractor-Features]]. An ablation measured them at +0.0016 AUC for Random Forest and +0.0000 for XGBoost, so removal cost almost nothing; the meta-learner and the delay MAE both *improved*.

No fabricated value now informs any reported result. The residual limitation is one of scope rather than data quality: contractor-specific effects on delay are outside what this study can explain, recorded in the manuscript's Data Availability limitation and flagged for future work.
