---
tags: [operations, ml-pipeline, howto]
status: active
created: 2026-08-08
updated: 2026-08-08
---

# Pipeline Rerun Guide

Run from `ml-service\` unless noted. **Do not use the scripts' bare defaults from this directory** — their relative-path defaults (e.g. `../../data/ready/train.csv`) assume you're inside `ml-service\models\`, not `ml-service\`, and fail with "Required input not found" if you don't override them. This has already caused a real failed run once — `train_trees.py`/`train_lstm.py` silently aborted, and `train_meta_learner.py`/`seed_supabase.py` ran anyway against stale artifacts, producing a fully successful-looking but wrong result.

```powershell
# 1. Only if raw source data changed:
python data_pipeline\preprocess.py --input "..\data\raw\Copy of 2022 conso Fund Transfer worksheet   (2).xlsx" --output-dir "..\data\processed"

# 2. Only if raw source data changed:
python data_pipeline\generate_synthetic_data.py

# 3. Always needed after any feature_engineering.py / preprocess.py change:
python data_pipeline\feature_engineering.py --monitoring-input ..\data\synthetic\monitoring_with_contractors.csv --contractors-input ..\data\synthetic\contractor_profiles.csv --fund-transfer-input ..\data\processed\fund_transfer_cleaned.csv --liquidation-input ..\data\processed\liquidation_cleaned.csv --crosswalk-input ..\data\processed\project_crosswalk.csv --output-dir ..\data\ready

# 4. Train Level 0 tabular learners (explicit paths -- see gotcha above):
python models\train_trees.py --train-csv ..\data\ready\train.csv --test-csv ..\data\ready\test.csv --artifacts-dir artifacts

# 5. Train Level 0 LSTM (slow -- several minutes at full defaults):
python models\train_lstm.py --sequences ..\data\ready\lstm_sequences.npy --mask ..\data\ready\lstm_sequence_mask.npy --project-keys ..\data\ready\lstm_project_keys.json --train-csv ..\data\ready\train.csv --test-csv ..\data\ready\test.csv --artifacts-dir artifacts

# 6. Train Level 1 meta-learner (no args needed -- paths computed from __file__):
python models\train_meta_learner.py

# 7. Seed Supabase (run from the REPO ROOT -- scripts/ lives there, not ml-service/):
cd ..
python scripts\seed_supabase.py --dry-run    # inspect first
python scripts\seed_supabase.py              # real write
```

## Verify after step 3

Log line should read: `Step 6: labeled 5159/8784 rows (...), of which ... 1260 of those via the Phase 8 D_start+1 clamp`. If those numbers drift, something upstream changed — see [[../02-Decisions/D03-Phase8-Clamp]] for what "correct" looks like.

## Verify after step 6

`train_meta_learner.py`'s log should say `Meta-learner training set: 1,124 rows`. A smaller/different number means steps 4–5 didn't write fresh artifacts (check they didn't silently abort) and step 6 trained on stale OOF predictions.

## Also missing `--contractors-input`?

Silently drops contractor features without erroring — see [[../03-ML-Pipeline/Stage3-Feature-Engineering]]'s gotcha note.
