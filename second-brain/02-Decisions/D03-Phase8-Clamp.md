---
tags: [decision, ml-pipeline, target-variable]
status: active
created: 2026-08-08
updated: 2026-08-08
---

# D03: Phase 8 D_start+1 Clamp

## Context

[[D02-Phase7-Lag-Correction|The Phase 7 lag correction]] occasionally pushed a short-duration project's corrected proxy date back before its own D_start — a negative implied duration, not credible. These rows were previously left unresolved entirely (~2,362 of them). Investigating them revealed two genuinely different situations hiding inside that one number.

## Options considered

1. Leave all ~2,362 unresolved, as before (safe, but discards real recoverable signal).
2. "Don't apply the median lag to projects that finished quickly" — the user's initial suggestion. Rejected: this is circular. We can't know which projects finished quickly without already knowing the true completion date, which is the exact unknown being estimated — selectively skipping the correction for "fast" projects would reintroduce the same late-bias for precisely the subset it's meant to fix.
3. Clamp every corrected date at `D_start + 1 day` uniformly, recovering all ~2,362 rows.
4. Split the ~2,362 rows by whether the **raw, uncorrected** proxy date is itself credible (after D_start), and only clamp that subset.

## Decision

Option 4, narrowed further after discovering the split. Splitting the rows found: **1,260** have a raw proxy date genuinely after D_start — a real event exists, only the flat lag subtraction over-corrects it non-credible — these are clamped at `D_start + 1 day`. **1,102** have a raw proxy date already at or before D_start *before any correction at all* — no real event to anchor a completion date to — these are left unresolved, exactly as before, never clamped. Implemented in `construct_target_variable()`, `ml-service/data_pipeline/feature_engineering.py`, commit `ef2e581`.

## Why

Option 3 (uniform clamp) was rejected after a further discovery mid-implementation: clamped rows mechanically get `T_actual = 1 day`, which is always below any `T_standard`, so **every clamped row gets RedFlag=0 by construction**, regardless of the project's real outcome. Applying that to all 2,362 rows — including the 1,102 with no real underlying event — would have fabricated a specific, false "not delayed" claim for over a thousand rows. Narrowing to only the 1,260 rows with a genuine underlying event keeps the clamp grounded in real evidence, while `completion_date_is_clamped` marks the recovered rows so their mechanically-forced RedFlag=0 can be discounted or excluded downstream. See [[../05-Known-Issues/Issue-Phase8-Clamp-Artifact]].
