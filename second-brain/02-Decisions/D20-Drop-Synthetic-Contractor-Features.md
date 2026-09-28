---
tags: [decision, ml-pipeline, features, objective-1, pre-registered]
status: pre-registration
created: 2026-09-29
updated: 2026-09-29
---

# D20: Removing the synthetic contractor features

> **Pre-registration written and committed BEFORE the retrain.** Results appended below without editing anything above the results heading.

## Why this is forced

`Issue-Synthetic-Contractor-Data` has been open since the pipeline was built, waiting on real contractor performance records from PPDO. **PPDO has confirmed it does not hold that data** — no register of contractor delivery reliability or historical delay rates exists, and no alternative source is available.

The issue therefore cannot be resolved by acquisition. The choice is between carrying fabricated features indefinitely and removing them.

## What is being removed

Five model features plus their join key:

| Feature | Origin |
|---|---|
| `historical_delay_rate` | `generate_synthetic_data.py`, drawn from a distribution |
| `reliability_score` | same |
| `contractor_spec_Both` | one-hot of a synthetic specialization |
| `contractor_spec_Infrastructure` | same |
| `contractor_spec_Non-Infrastructure` | same |
| `contractor_id` | synthetic join key, already excluded from the matrix |

Feature count 94 → 89.

**`generate_synthetic_data.py` itself is retained.** It passes through the real monitoring rows that the pipeline consumes; only the contractor join is dropped. Deleting the script would break the pipeline's input for no benefit.

## The measurement that justifies it

Ablated before this decision was taken, on the current 94-feature set:

| Model | AUC without | AUC with | Δ | Accuracy Δ | Share of importance |
|---|---|---|---|---|---|
| Random Forest | 0.9127 | 0.9143 | **+0.0016** | +0.0074 | 2.9% |
| XGBoost | 0.9759 | 0.9759 | **+0.0000** | +0.0011 | 5.3% |

Removing every fabricated value from the model costs at most **0.0016 AUC** on one base learner and nothing at all on the stronger one.

## Predicted outcome of the retrain

1. **Meta-learner AUC moves by less than ±0.005** from 0.9593.
2. **XGBoost test AUC is unchanged** to three decimal places (0.976).
3. **Random Forest loses at most 0.008 accuracy** from 0.8408.
4. **Delay MAE moves by less than ±3 days** from 87.49.

## Why removal is the right call rather than disclosure

Keeping them would require defending, at a panel, why a model informing public-sector resource allocation conditions its predictions on invented contractor attributes. There is no good answer to that, and the ablation removes any need to find one: the features were not doing meaningful work.

Removal also makes Objective 1's amended wording true rather than merely qualified — the framework draws on project timelines, fund-transfer and liquidation records, monitoring observations, and external contextual variables, and **no synthetic input informs any reported result**.

The cost is real and should be stated: contractor-specific effects on delay move outside the study's explanatory scope entirely. That is a genuine narrowing, and it belongs in Chapter 5 as future work rather than being glossed over.

## Success criteria

- Target unchanged: **N=5884, D=8277, K=1159**, train 4,119 / test 1,765, meta-learner 1,451 rows.
- Snapshot to `artifacts_pre_contractor_drop/`.
- No `contractor_*`, `historical_delay_rate` or `reliability_score` column survives in the feature manifest.

---

# Results

_To be appended after the retrain. Nothing above this line is to be edited._
