---
tags: [decision, ml-pipeline, features, objective-1, pre-registered]
status: pre-registration
created: 2026-09-28
updated: 2026-09-28
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

_To be appended after the retrain. Nothing above this line is to be edited._
