---
tags: [decision, ml-pipeline, data-quality, target-variable]
status: active
created: 2026-08-15
updated: 2026-08-15
---

# D09: Study-Period Floor (Phase 9)

## Context

While quantifying the [[../05-Known-Issues/Issue-Climate-Data-Coverage-Gap|climate-data-coverage-gap]] known issue, 3 labeled rows surfaced with `D_start` dated 2010-01-17, 2010-12-27, and 2013-09-26 — all 8-13 years before every other row in their own monitoring batch (same `FILE NAME`/`Year`, e.g. 23 "Monoblock Chairs" rows filed under `FILE NAME="March 2023"` cluster 2018-2022 except one outlier at 2010-01-17). Traced to the raw source cell (Excel serial `40195`), confirming these are faithfully-parsed but almost certainly mis-keyed values in the original PPDO spreadsheet, not a pipeline bug.

## Options considered

1. Enforce Chapter 1's stated "2016-2025" study period as a hard `D_start >= 2016-01-01` floor on the modeling population.
2. Use only the batch-year-deviation diagnostic (row's `D_start` year vs. its own `Year` column) as the exclusion rule, at a low threshold.
3. Find the boundary the *data itself* shows, rather than importing either a manuscript citation or a heuristic threshold.

## Decision

Option 3. `STUDY_PERIOD_START = 2015-01-01`, exploiting a genuine gap in the raw data: across the full 8,784-row monitoring population, **zero** rows have `D_start` in 2011, 2012, or 2014. The 3 known-bad rows (2010 x2, 2013 x1) sit isolated below that gap; 2015 onward is a contiguous run. Rows with `D_start < 2015-01-01` are dropped (full pipeline scope — train/test *and* inference.csv), which catches exactly the 3 confirmed rows. A companion diagnostic (non-blocking, `BATCH_YEAR_DEVIATION_THRESHOLD_YEARS = 6`) flags rows whose `D_start` deviates from their own batch's `Year` column by more than 6 years, for manual review in `date_anomaly_review.csv` — 6 rows full-population.

Implemented in `construct_target_variable()`, `ml-service/data_pipeline/feature_engineering.py`.

## Why

Option 1 was tried first and rejected mid-implementation: it also silently dropped 381 labeled rows dated in 2015 that were never shown to be erroneous — their deviation from their own batch's `Year` column is only -2 to -5, well inside the normal range for this dataset (a monitoring-report batch routinely reviews projects released several years earlier; deviations of 1-6 years occur in the hundreds across the full population and are not on their own implausible). Removing that cohort would have been a study-scope decision ("we only model 2016+"), not a data-quality fix, and an order of magnitude larger than what the actual evidence supported — flagged and corrected before shipping, see conversation log 2026-08-15.

Option 2 alone (threshold-only, no absolute floor) was also tried and rejected: at a threshold low enough to catch the 3 known rows using pure deviation-from-batch (threshold=4), it flagged 167 rows full-population — the deviation distribution is a smooth, continuous decay (-1: 1840 rows, -2: 1126, -3: 868, -4: 336, -5: 133, -6: 29, then an isolated -7/-8/-9/-13 tail), not bimodal, so no threshold cleanly separates "normal administrative lag" from "genuine error" on that signal alone. The data's own year-gap is a categorically different, much cleaner signal — an absence, not a fuzzy distributional tail — which is why it's the hard rule while batch-deviation stays diagnostic-only.

Net effect: labeled population 5,159 → 4,804 (with [[D11-Exact-Duplicate-Removal|Phase 11]] and [[D10-Direct-Date-Credibility-Check|Phase 10]] combined); Phase 9 alone accounts for exactly 3 of those.
