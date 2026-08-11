---
tags: [ml-pipeline, stage, target-variable]
status: active
created: 2026-08-08
updated: 2026-08-08
---

# Stage 3: feature_engineering.py

The single most important file in the pipeline — this is where the target variable (RedFlag) is actually constructed, and where most of the project's hardest, most-revisited decisions live. Input: `data/processed/*.csv` + `data/synthetic/*.csv`. Output: `data/ready/{train,test,inference}.csv`, LSTM sequence tensors, feature column metadata.

## What it does, in order

1. `construct_target_variable()` — computes `D_start` (DATE RELEASED, falling back to DATE MONITORED), resolves a completion date (direct, or [[../02-Decisions/D01-Proxy-Completion-Dates|proxy]] with [[../02-Decisions/D02-Phase7-Lag-Correction|lag correction]] and the [[../02-Decisions/D03-Phase8-Clamp|Phase 8 clamp]]), and derives `RedFlag`/`NegativeSlippage_pct` against `T_standard` (365 days Infrastructure, 182 Non-Infrastructure).
2. Feature engineering — release_month/quarter/days_since_release/is_wet_season_release (all derived from the *same* resolved `D_start`, not re-parsed from the raw column — an earlier bug had these silently NaN for ~1,282 rows before this was fixed), one-hot encodings (STATUS_clean, municipality_canonical, project_type, contractor_spec), synthetic contractor feature join.
3. Multiple imputation (IterativeImputer/MICE) on numeric columns — explicitly excludes target-derived columns from both input and fit, to avoid leaking the label into the imputer.
4. Outlier flagging per project_type.
5. LSTM sequence assembly (`assemble_lstm_sequences()`) — release → liquidation → monitoring-visit event sequences, one per crosswalk project, padded to length 5 with a `-1` sentinel (not 0, since `event_type=0` is a legitimate real value).
6. Train/test split at the project level (70/30, seed 42) — see [[../02-Decisions/D07-No-Third-Validation-Split]].

## Current numbers (post Phase 8 clamp)

8,784 total monitoring rows → 5,159 labeled (58.7%) → 3,612 train / 1,547 test. Full breakdown and the exact log line to check after a re-run: [[../06-Operations/Pipeline-Rerun-Guide]].

## Gotcha

`--contractors-input` is easy to forget on a manual re-run — omitting it silently drops the `contractor_spec_*` family and `historical_delay_rate`/`reliability_score` features without erroring (feature count drops from 130 to ~121, the only visible symptom).
