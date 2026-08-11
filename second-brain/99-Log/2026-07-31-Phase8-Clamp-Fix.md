---
tags: [log]
status: active
created: 2026-08-08
updated: 2026-08-08
---

# 2026-07-31 — Phase 8 Clamp Fix

Triggered by a user question about the difference between resolved and unresolved projects, and a follow-up push-back when an earlier explanation ("no recorded event to anchor a proxy date to") turned out to be imprecise — nearly every row does have its own DATE MONITORED. Re-verifying against real data found the true cause: most of the ~2,384 unrecoverable rows were failing a chronological sanity check (lag-corrected proxy date landing before D_start), not lacking an event entirely.

User's first proposed fix ("don't apply the median lag to projects that finished quickly") was identified as circular/bias-introducing and not implemented as literally suggested — see [[../02-Decisions/D03-Phase8-Clamp]] for the alternative that was proposed and approved instead, and the further split (1,260 "correction overshoot" vs. 1,102 "raw invalid") discovered mid-implementation and confirmed with the user before writing code.

Implemented in `feature_engineering.py`, committed `ef2e581`, verified end-to-end in sandbox (smoke-test only), then re-verified by the user on their own machine with full-epoch LSTM training. One real operational bug surfaced along the way: the user's first attempt at re-running `train_trees.py`/`train_lstm.py` aborted silently due to a CWD-relative-path mismatch, and `train_meta_learner.py`/`seed_supabase.py` ran anyway against stale pre-clamp artifacts without erroring — caught, explained, corrected commands given, re-run succeeded and pushed to Supabase. Methodology report updated twice: once with sandbox-verified placeholder numbers (explicitly marked stale), then again with the user's real final-run numbers once available. See [[../03-ML-Pipeline/Stage6-Meta-Learner]] for the numbers that resulted, and [[../06-Operations/Pipeline-Rerun-Guide]] for the corrected commands.

This vault (`second-brain/`) and the MCP bridge setup were built the same day as a follow-up, at the user's request.
