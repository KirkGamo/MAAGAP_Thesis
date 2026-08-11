---
tags: [open-issue, ml-pipeline, target-variable]
status: active
created: 2026-08-08
updated: 2026-08-08
---

# Open Issue: Phase 8 Clamp Construction Artifact

1,260 rows (1,026 of which enter train/test) have their completion date clamped at `D_start + 1 day` because [[../02-Decisions/D02-Phase7-Lag-Correction|the Phase 7 lag correction]] alone pushed an otherwise-credible raw proxy date to a non-credible pre-D_start value. See [[../02-Decisions/D03-Phase8-Clamp]] for the full decision record.

## Why this matters

RedFlag is 0 for every one of these rows purely because `T_actual = 1 day` is mechanically below any `T_standard` — this is **not** observed evidence of on-time completion. It's a real, if narrow, source of bias in the "not delayed" class.

## How to work around it

`completion_date_is_clamped` in `data/ready/train.csv`/`test.csv` marks the affected rows explicitly. Anyone wanting a stricter evidentiary standard can filter these out and re-measure metrics on the remaining, fully-evidence-backed population. This hasn't been done yet as a formal robustness check — would be a reasonable addition before final defense if time allows.
