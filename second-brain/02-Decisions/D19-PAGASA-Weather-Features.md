---
tags: [decision, ml-pipeline, features, objective-1, pre-registered]
status: active
created: 2026-09-28
updated: 2026-09-30
---

# D19: PAGASA Weather Features — pre-registration

> **This section was written and committed BEFORE the features were built or the model retrained.** It records what was expected, so the measured result means something in either direction. Results are appended below, after the fact, without editing anything above the results heading.

## What is being added

Seven features derived from the extracted PAGASA daily series (`data/external/pagasa_iloilo_*_daily.csv`, station ILOILO RADAR 98637), replacing `is_wet_season_release` as the pipeline's only weather signal — a June–November calendar flag the code itself annotates as "NOT an actual weather observation".

| Feature | Window |
|---|---|
| `rain_total_mm_180d` | D_start → D_start + 180d |
| `rain_days_180d` | days with > 0 mm |
| `heavy_rain_days_180d` | days ≥ 50 mm |
| `max_24h_rain_mm_180d` | wettest single day |
| `mean_tmax_c_180d` | mean daily maximum |
| `hot_days_180d` | days with Tmax ≥ 35 °C |
| `rain_total_mm_prior_90d` | D_start − 90d → D_start |

## Why a fixed 180-day window rather than the scheduled window

The obvious choice is `[D_start, D_start + T_standard]`, but `T_standard` takes only two values (365 days for Infrastructure, 182 for Non-Infrastructure) and is a deterministic function of `project_type`, which is already a feature. A window whose *length* varies with project type would make every rainfall total partly an encoding of project type, and the model could learn the split rather than the weather.

A fixed 180-day window is the same length for every project, so totals are directly comparable, and it still covers the critical early execution phase. It is also available at prediction time for an ongoing project with no completion date, which matters because the optimizer scores exactly that population.

## The leakage constraint this respects

`T_actual = Date of Completion − D_start`, and `RedFlag` compares it to `T_standard`. A window of `[D_start, D_end]` would have a length equal to the project duration — which **is** the label — so rainfall summed over it would be mechanically larger for delayed projects. Every window above is anchored only to `D_start` and a constant, so none can encode the outcome.

This is not hypothetical: the same failure mode produced MAE 0.91 days and R² 0.9994 in this project's regression head, and was caught only because the number was implausibly good. A weather feature would leak more subtly.

## Predicted outcome

**A small effect, plausibly indistinguishable from run-to-run noise.** Stated plainly so it cannot be rationalised afterwards:

1. **Meta-learner AUC-ROC moves by less than ±0.010**, i.e. within the noise band this stack has shown across D14/D15/D16.
2. **XGBoost test AUC moves by less than ±0.005.** It sits at 0.976 and has been flat through three previous feature changes.
3. **Delay-magnitude MAE improves by less than 5 days** from its current 86.36. If it improves by more than 15 days, suspect leakage before celebrating.
4. **Random Forest is the most likely to move**, having been the learner most sensitive to feature-set changes (D16 cost it 0.849 → 0.827 accuracy).

## Why a small effect is expected

Two structural reasons, neither a defect in the data:

- **One station serves 44 municipalities.** Weather varies by date and never by location, so two projects running concurrently at opposite ends of Iloilo receive identical values. These features cannot explain cross-sectional variation between concurrent projects, only temporal variation.
- **The model already carries four date-keyed features** — `Year`, `release_month`, `release_quarter`, `days_since_release` — plus `is_wet_season_release`. Iloilo's rainfall is strongly seasonal, so a monsoon signal is substantially *already present* through `release_month` and `release_quarter`. The new features' incremental content is the deviation of a given year's weather from the seasonal norm, which is a much smaller quantity than the seasonality itself.

## What would make this worth keeping anyway

Even at a negligible ΔAUC, the substitution is worth making for Objective 1, which claims "weather patterns from PAGASA" as an external contextual variable. Replacing an acknowledged calendar proxy with eleven years of observed daily rainfall makes that claim literally true. The honest framing is then: *the integration was made, and measured, and the measured contribution was small* — which is a finding, and a more defensible one than asserting features help without testing.

## Success criteria for the retrain itself

Independent of effect size, the retrain must satisfy:

- The target checkpoint is unchanged: **N=5884, D=8277, K=1159, train 4,119 / test 1,765**, meta-learner 1,451 rows. Any movement means weather has leaked into the label — stop and find it.
- Prior artifacts snapshotted to `artifacts_pre_weather/`.
- Ablation run with and without the block, everything else held fixed.

---

# Results

_Appended 2026-09-28 after the retrain. Nothing above this line was edited._

## Retrain integrity

Every success criterion held. The target did not move:

- Checkpoint **N=5884, D=8277, K=1159**, train **4,119** / test **1,765**, meta-learner **1,451 rows** — identical to the pre-weather run, so nothing leaked into the label.
- Weather joined to **8,267 of 8,277 rows (99.9%)**; the remainder keep NaN.
- No labelled row's window is truncated: the latest labelled `D_start` is 2025-12-23, whose 180-day window ends 2026-06-21, inside the record's 2026-09-30 end. Only 7 inference rows (0.3%) truncate.
- Feature count 87 → 94. Prior artifacts snapshotted to `artifacts_pre_weather/`.

## Measured effect (ablation, everything else held fixed)

| Model | Metric | without weather | with weather | Δ |
|---|---|---|---|---|
| Random Forest | accuracy | 0.8266 | 0.8408 | **+0.0142** |
| | precision | 0.8514 | 0.9144 | **+0.0630** |
| | recall | 0.8209 | 0.7766 | −0.0443 |
| | F1 | 0.8358 | 0.8399 | +0.0041 |
| | AUC-ROC | 0.9066 | 0.9143 | +0.0077 |
| XGBoost | accuracy | 0.9235 | 0.9235 | 0.0000 |
| | F1 | 0.9269 | 0.9270 | +0.0001 |
| | AUC-ROC | 0.9758 | 0.9759 | **+0.0001** |
| Meta-learner | accuracy | 0.8863 | 0.8880 | +0.0017 |
| | F1 | 0.8618 | 0.8630 | +0.0012 |
| | AUC-ROC | 0.9569 | 0.9593 | **+0.0024** |
| Delay MAE (XGB) | days | 86.36 | 87.49 | **+1.13 (worse)** |

## Predictions versus outcome

| # | Predicted | Outcome | |
|---|---|---|---|
| 1 | Meta AUC within ±0.010 | +0.0024 | ✅ |
| 2 | XGBoost AUC within ±0.005 | +0.0001 | ✅ |
| 3 | MAE improves by < 5 days | worsened by 1.13 days | ✅ small, wrong direction |
| 4 | Random Forest moves most | RF moved most on every metric | ✅ |

All four held. The effect is small, exactly as predicted and for the reasons predicted.

## The finding worth carrying into Chapter 4

**Feature importance badly oversells this block, and the ablation is what exposes it.**

The weather features account for **46.9% of Random Forest's total importance** and **20.9% of XGBoost's**, ranking #3 through #9 in RF — `max_24h_rain_mm_180d` and `mean_tmax_c_180d` sit third and fourth in both models. On importance alone, this would read as a major contribution.

The ablation says otherwise: removing all seven costs XGBoost 0.0001 AUC and the meta-learner 0.0024.

The explanation is redundancy, not irrelevance. `days_since_release` and `Year` rank #1 and #2 in both models, and `rain_total_mm_180d` correlates **−0.476 with `release_month`**. Iloilo's rainfall is strongly seasonal, so the monsoon signal was already present through the existing date features; the models happily redistribute importance onto the new, more granular encodings of the same underlying signal without learning anything they did not already know. The genuinely new content — a given year's deviation from the seasonal norm — is small.

**Anyone reporting these features via SHAP or importance rankings without an ablation would substantially overstate their value.** That is a methodological point worth making in its own right, and it is the reason the ablation was pre-registered rather than run as an afterthought.

## A second finding: the crude proxy was nearly as good

`is_wet_season_release` — a June–November calendar flag the code annotates as "NOT an actual weather observation" — turns out to have captured most of the available signal. Eleven years of daily station observations improve the meta-learner by 0.0024 AUC over it.

That retroactively **validates** the original proxy rather than embarrassing it, and it is a more interesting result than a large gain would have been: it says the weather dependence of these projects is seasonal rather than driven by specific storm events, which is a substantive claim about Philippine provincial project delay, not merely a modelling note.

## Decision: keep the features

Kept, for three reasons:

1. Objective 1 claims "weather patterns from PAGASA" as an external contextual variable. These make that claim literally true, replacing an acknowledged proxy with observed data from a named instrument.
2. Classification — the primary task — improves marginally at every level (RF +0.0077 AUC, meta +0.0024).
3. The measured smallness is itself reportable, and more defensible than asserting a contribution never tested.

Against: delay MAE worsens by 1.13 days, within run-to-run noise but in the wrong direction. Recorded rather than buried.

`is_wet_season_release` is **retained** alongside them. It costs one feature, it is what the new block was measured against, and removing it now would make the comparison unreproducible.

## Caveats for Chapter 3

- **One station, 44 municipalities.** These vary by date and never by location; two concurrent projects at opposite ends of Iloilo receive identical weather. Objective 1 should say *provincial* weather observations, not project-site conditions.
- Temperature begins 2016-05, so `mean_tmax_c_180d` is NaN for 171 training rows whose window predates the record.
- Four source pages disagree with their own printed sums and three individual days contradict themselves; all are documented in `pagasa_extraction_report.json` and left uncorrected.

## Still pending

**Supabase has not been reseeded.** Live `risk_tier` values still come from the pre-weather models. That touches production data and is held as a separate, explicit approval, consistent with how D14/D15 were handled.

## Related

- [[D16-Observed-Status-Feature-Encoding]] — the controlled-retrain discipline followed here
- [[D17-Allocation-Efficiency-Measurement]] — the other place where measuring overturned an assumption
- [[../05-Known-Issues/Issue-Climate-Data-Coverage-Gap]] — now largely resolved; the delivered data runs to 2026


---

## Correction, 2026-09-30 — window off-by-one

The figures above were computed with a window-aggregation bug. Aggregates used
`cumulative_at(end) - cumulative_at(start)`, and because the cumulative value at
the start day already includes that day, subtracting it silently dropped
**D_start itself** — the project's own first day of execution — from every
window.

Found by `tests/test_external_features.py`, which counted rain days across a
three-day window containing two and got one. Windows are now inclusive of
D_start, as the docstrings always claimed.

Recomputed and retrained on the corrected features, target held fixed
(N=5884, D=8277, K=1159, train 4,119 / test 1,765, meta-learner 1,451):

| | before fix | after fix |
|---|---|---|
| Random Forest AUC | 0.9210 | 0.9222 |
| Random Forest accuracy | 0.8521 | 0.8516 |
| XGBoost AUC | 0.9767 | 0.9762 |
| Meta-learner AUC | 0.9600 | 0.9581 |
| Meta-learner accuracy | 0.8963 | 0.8880 |
| Delay MAE | 86.54 d | 86.38 d |

**No conclusion in this record changes.** The shifts are within this stack's
run-to-run noise and the ablation findings — small incremental contribution,
importance overstating it — hold in both directions. The corrected figures are
the ones to quote in Chapter 4.
