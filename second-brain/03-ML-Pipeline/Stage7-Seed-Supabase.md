---
tags: [ml-pipeline, stage, deployment]
status: active
created: 2026-08-08
updated: 2026-08-08
---

# Stage 7: seed_supabase.py

Scores the currently-ongoing population (`data/ready/inference.csv` — NOT `test.csv`; see [[Stage8-Optimization-Engine]] for why this distinction matters), computes SHAP explanations ([[../02-Decisions/D08-SHAP-Explainability]]), and upserts into Supabase's `projects` table in batches of 500 on `project_key` conflict.

## Location gotcha

Lives at the **repo root** `scripts/`, not inside `ml-service/`. Running `python scripts\seed_supabase.py` from `ml-service\` fails with "No such file" — run it from the repo root, or from `ml-service\` as `python ..\scripts\seed_supabase.py`.

## Always dry-run first

`--dry-run` prints a sample row (including the full SHAP breakdown) without writing — inspect it before committing to a real write, especially after any change to the target variable or feature set upstream.

## What gets written vs. excluded

Every ongoing project gets a `projects` row; only the subset with a matching LSTM sequence gets a full meta-learner score (risk_tier/risk_probability/shap_top_features) — the rest are written unscored, with a logged count. Projects whose STATUS confirms completion or refund are still scored (for the audit-signal display) but excluded from `optimization_engine.py`'s scheduling pool — see [[../02-Decisions/D06-Status-Excludes-Scheduling]].
