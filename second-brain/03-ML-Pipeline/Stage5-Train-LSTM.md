---
tags: [ml-pipeline, stage, level-0]
status: active
created: 2026-08-08
updated: 2026-08-08
---

# Stage 5: train_lstm.py

Trains the sequential Level 0 base learner on per-project event sequences (fund release → liquidation → monitoring visit; max length 5, 3 features per step, `Masking(mask_value=-1.0)` layer to skip padding). Small, heavily-regularized architecture (one LSTM layer with dropout + recurrent_dropout, small dense head with its own dropout) — deliberately shallow given how small the sequence-matched population is.

## Population is the tightest constraint in the whole stack

Only projects with BOTH a resolved tabular row AND a crosswalk-linked event sequence qualify — currently 1,124 train (31.1% of 3,612) / 477 test (30.8% of 1,547), up from 812/346 pre-[[../02-Decisions/D03-Phase8-Clamp|Phase 8 clamp]]. See [[../00-Maps/MOC-Known-Issues|Known Issues]] for why this keeps being the bottleneck the meta-learner inherits.

## Current metrics (final run, epochs=60/batch_size=8, unrestricted hardware)

Test: accuracy 0.558, precision 0.468, recall 0.894, AUC-ROC 0.660. High-recall/low-precision — see [[../05-Known-Issues/Issue-LSTM-Low-Precision]]. This base learner's output should be read as noisy directional signal for the meta-learner, not a standalone risk score.

## Sandbox note

`--epochs`/`--batch-size` exist specifically as an escape hatch for constrained environments (module docstring names this explicitly) — see [[../06-Operations/Sandbox-Constraints]] for why a sandbox verification run must never be reported as final metrics.
