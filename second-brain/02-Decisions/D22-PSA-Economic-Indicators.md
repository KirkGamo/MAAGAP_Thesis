---
tags: [decision, ml-pipeline, features, objective-1]
status: active
created: 2026-09-29
updated: 2026-09-29
---

# D22: PSA Region VI economic indicators

## Context

Objective 1 names "PSA economic indicators" as an external contextual variable. `scripts/fetch_psa_data.py` existed as a working PX-Web client but nothing imported it, its `PRICES_DATASET_ID` was still `REPLACE_ME`, and **zero of the model's features were PSA-derived**. This closes that gap, completing Objective 1's external-data claim alongside [[D19-PAGASA-Weather-Features]].

## What was available, and what was not

The series one would want is a **construction-materials price index for Region VI**. PSA publishes such indices — CMRPI and CMWPI — and **every one of them is National Capital Region only**. There is no regional construction price index for Western Visayas.

That forces a choice between an index that is construction-specific but describes Metro Manila, and one that describes Western Visayas but is not construction-specific.

This takes the second and narrows it as far as the data allows. The Consumer Price Index is published by region *and* by commodity group, and one group is materials for dwelling maintenance and repair — construction materials, in the right region, monthly:

| Feature | Series |
|---|---|
| `cpi_all_items_yoy_at_start` | general regional inflation |
| `cpi_housing_yoy_at_start` | housing, water, electricity, gas, fuels |
| `cpi_repair_materials_yoy_at_start` | materials for dwelling maintenance/repair |
| `cpi_repair_materials_yoy_mean_180d` | mean cost pressure over early execution |

**Report this in Chapter 3 as regional *consumer* price inflation used as a proxy for construction cost pressure, never as a construction price index.**

## Two implementation decisions worth recording

**Year-on-year change, not index level.** No single table spans 2015–2026: the 2012-based series runs 2012–2021 and the 2018-based 2018–2026, and their levels are not comparable since each is 100 at its own base. Concatenating levels would create a discontinuity at the join that the model would read as a real economic event. YoY change is base-invariant, so computing it *within* each series and then concatenating yields one continuous series. It is also the better feature: what plausibly affects a project is cost pressure, not the index level.

**CSV, not json-stat2.** OpenSTAT accepts a json-stat2 request and returns a well-formed envelope whose `size` declares 9 years × 13 periods — and a `value` array of length **one**. The CSV endpoint returns the full matrix for the identical query. Recorded because the json-stat2 response looks valid and silently is not.

Result: 164 monthly rows, 2013-01 to 2026-08, joined to **8,267 of 8,277 rows (99.9%)**.

## Measured effect (ablation, target held fixed)

| Model | Metric | without PSA | with PSA | Δ |
|---|---|---|---|---|
| Random Forest | AUC-ROC | 0.9127 | 0.9210 | **+0.0083** |
| | accuracy | 0.8334 | 0.8521 | **+0.0187** |
| XGBoost | AUC-ROC | 0.9759 | 0.9767 | +0.0008 |
| | accuracy | 0.9224 | 0.9229 | +0.0005 |
| Meta-learner | AUC-ROC | 0.9597 | 0.9600 | +0.0003 |
| | accuracy | 0.8946 | 0.8963 | +0.0017 |
| | F1 | 0.8706 | 0.8740 | +0.0033 |
| Delay MAE | days | 86.00 | 86.54 | +0.54 (worse) |

Every classification metric improves. Random Forest's +0.0187 accuracy is the **largest single gain from any external block** so far. MAE worsens by half a day, within noise.

Feature count 89 → 93. Checkpoint unchanged: N=5884, D=8277, K=1159, train 4,119 / test 1,765.

## The pattern, now observed three times

| Block | Share of RF importance | Meta-learner ΔAUC |
|---|---|---|
| PAGASA weather (D19) | 46.9% | +0.0024 |
| PSA economic (D22) | 25.2% | +0.0003 |
| Synthetic contractor (D20) | 2.9% | −0.0003 |

**High feature importance, small ablation gain — three times running.** The cause is the same each time: `days_since_release` and `Year` rank #1 and #2, and every external block is keyed on the calendar. Regional inflation is close to a deterministic function of the year; Iloilo's rainfall is strongly seasonal. The models redistribute importance onto finer encodings of a signal they already had.

This is now a robust, repeated finding rather than a one-off, and it is the most transferable methodological point this project has produced: **in a model already carrying strong temporal features, externally-joined time series will appear important and contribute little. Only an ablation distinguishes the two.**

It bears directly on Objective 5, which reports SHAP feature rankings as its interpretability component — those rankings would substantially overstate the contribution of every external block.

## Decision: keep

Kept. Every classification metric improves, Random Forest materially so, and the block makes Objective 1's "PSA economic indicators" claim literally true rather than aspirational. The MAE regression of half a day is inside run-to-run noise and is recorded rather than buried.

## Caveats for Chapter 3

- A **consumer** price index standing in for construction costs, because no regional construction index exists.
- Values vary by **month and never by project**: every project starting in the same month receives identical figures. Like the weather block, this can describe temporal variation but not distinguish concurrent projects.
- The 2012-based and 2018-based tables are chained via YoY; the join is continuous but the underlying baskets differ.

## Related

- [[D19-PAGASA-Weather-Features]] — the other half of Objective 1's external variables, same pattern
- [[D20-Drop-Synthetic-Contractor-Features]] — the third data point in the importance-versus-ablation pattern
