---
tags: [decision, ml-pipeline, target-variable]
status: active
created: 2026-08-08
updated: 2026-08-08
---

# D01: Universal Proxy Completion Date Recovery

## Context

RedFlag (the binary slippage label) requires `T_actual = Date of Completion − D_start`. Most monitoring rows never had a direct `Date of Completion` value filled in the source workbook — under a strict "only label what's directly observed" rule, the labeled population was tiny (Phase 3 baseline: 231 train / 99 test rows, ~7.6% RedFlag positive), too small to train a meaningful model.

## Options considered

1. Leave unlabeled rows unlabeled, accept a tiny training set.
2. Fabricate a completion date from elapsed time or STATUS alone.
3. Recover a **proxy** completion date from other real, recorded events for the same project — the latest monitoring visit or linked liquidation submission — but only when STATUS explicitly confirms the project is completed/functional.

## Decision

Option 3. `compute_proxy_completion_dates()` in `feature_engineering.py` takes the max of a monitoring row's own DATE MONITORED and its crosswalk-linked liquidation's Date Submitted, and uses it as a stand-in completion date — but *only* when `STATUS_clean` matches a completed/functional substring. A project without a recorded completion date whose STATUS doesn't confirm it's finished stays ongoing/unresolved (routed to `inference.csv`), never guessed at.

## Why

This is real, recorded history, not fabrication — every recovered date corresponds to an actual event PPDO staff logged. It grew the labeled population from ~330 to several thousand rows, making the modeling task viable at all. The tradeoff: a proxy date is a systematically **late** upper bound on true completion (the last time someone happened to visit or submit paperwork isn't the day work actually finished), which inflates the apparent RedFlag rate for proxy-dated rows. This bias is what [[D02-Phase7-Lag-Correction]] and later [[D03-Phase8-Clamp]] address. See [[../05-Known-Issues/Issue-Proxy-Date-Dependence]] for the caveat that persists regardless.
