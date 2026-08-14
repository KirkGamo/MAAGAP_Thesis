---
tags: [decision, ml-pipeline, data-quality, target-variable]
status: active
created: 2026-08-15
updated: 2026-08-15
---

# D10: Direct Completion-Date Credibility Check (Phase 10)

## Context

[[D02-Phase7-Lag-Correction|Phase 6/8]] already reject an implausible PROXY completion date — one at or before `D_start` implies a non-positive project duration and is treated as no-usable-proxy, never silently accepted (`proxy_usable` requires `proxy_dates_final > d_start`). No equivalent check existed for a **directly-observed** `Date of Completion`: a 2026-08-15 audit found 120 labeled rows (2.3% of the then-5,159-row population) where the recorded completion date is on or before `D_start`, yet `has_completion_date=True` let them flow straight through to a labeled `RedFlag=0` — the same mechanical-artifact-not-evidence problem [[D03-Phase8-Clamp|Phase 8]] already guards against for proxies, just missing on the direct-date side. 60% of the 120 trace to `D_start` itself coming from the `DATE MONITORED` fallback (a routine verification visit, plausibly logged well after actual completion, not a start-of-project event); the rest are a direct contradiction between the raw `DATE RELEASED`/`Date of Completion` cells.

## Options considered

1. Leave direct dates unchecked, as before (matches historical behavior, but leaves a known-bad label class un-audited).
2. Drop rows with a non-credible direct date outright (mark unresolved, no recovery attempt).
3. Discard the non-credible direct date and re-route the row through the existing Phase 6/7/8 proxy-recovery machinery, exactly as if no direct date had been recorded.

## Decision

Option 3. `d_end_direct` is NaT'd wherever `d_start.notna() & (d_end_direct <= d_start)`, computed immediately after the raw date is parsed, before `missing_direct_date` is derived. This means a row with a non-credible direct date now falls into the same "STATUS confirms completed, try to recover a proxy date" path Phase 6 already provides for missing dates — some recover a credible proxy and stay labeled, the rest correctly fall through to unresolved → inference.csv. Flagged via `direct_date_rejected_not_credible` for downstream auditability. Implemented in `construct_target_variable()`, `ml-service/data_pipeline/feature_engineering.py`.

## Why

Option 2 was rejected: it would discard real, useful signal on the ~60% of rows where a genuinely later, valid event (a subsequent monitoring visit or liquidation record) could still serve as a credible proxy — the problem is specifically the *direct* date, not that these projects are unresolvable. Option 3 reuses 100% of the existing, already-audited Phase 6/7/8 machinery rather than adding new branching logic, and treats "a completion date that's chronologically impossible" as equivalent to "no completion date recorded" — which is the accurate characterization; a self-contradictory date is not evidence, whether or not a project is otherwise resolvable.

Net effect (measured against the post-Phase-9/11 population, 8,278 rows): 133 rows flagged non-credible. This 133 does **not** map 1:1 onto the labeled-population loss, and is worth spelling out explicitly rather than leaving as an implied gap: 23 of the 133 are `project_type == "Unclassified"` rows that were never part of the original 5,159-row labeled population to begin with (Unclassified has no defined `T_standard`, so it can never be labeled regardless of date credibility — this check runs against the full post-Phase-9/11 population, not just previously-labeled rows). Of the remaining 110 rows that *were* previously labeled: 43 recovered a credible proxy date and remain labeled; **67** correctly became unresolved — this 67 is the figure that appears in the labeled-population accounting (5,159 → 4,804 via 285 dedup + 3 study-floor + 67 here). Confirmed by direct query against `mon_row_id` membership in the pre- and post-cleanup labeled sets, cross-checked against `project_type_Unclassified` on the 23-row remainder (2026-08-15).
