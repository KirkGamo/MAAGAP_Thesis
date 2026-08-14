---
tags: [open-issue, data-availability]
status: active
created: 2026-08-15
updated: 2026-08-15
---

# Open Issue: Climate Data Coverage Gap (2025)

The PAGASA climate data request (real rainfall/wind observations, intended to replace the coarse [[../04-Data-Model/Glossary|is_wet_season_release]] proxy — see `feature_engineering.py`'s `WEATHER_EXTENSION_KEYWORDS`) is capped at 31 December 2024 by PAGASA's own request form, not by choice — the form's End Date field enforces this regardless of what's entered. The raw fund-transfer/monitoring data extends into 2025 (max `D_start` 2025-12-23); no 2026 rows exist yet.

## Why this matters

Real PAGASA data, once received, can only replace the proxy for the portion of the labeled population dated 2015-2024 (2015 is the labeled population's floor as of the 2026-08-15 data-quality cleanup — see [[../02-Decisions/D09-Study-Period-Floor]]). Verified against the post-cleanup 4,804-row labeled population (`data/ready/train.csv` + `test.csv`, keyed on `D_start`, no nulls):

- **189 of 4,804 rows (3.93%)** fall in 2025 — all of them, since 2026 has zero rows.
- Evenly split, not concentrated: 126/3,363 train (3.75%) and 63/1,441 test (4.37%) — no stratification concern.
- `is_wet_season_release` already covers these 189 rows as fallback signal, so they aren't left with no weather feature at all, just the coarser one.

At under 4% of the population and split-balanced, this is a footnote-scale caveat for Chapter 1's Data Availability limitation and the methodology report — not something that needs a design change (e.g. dropping 2025 rows, or delaying the PAGASA request). State it plainly rather than either hiding it or over-weighting it.

## What would resolve it

A follow-up PAGASA request once 2025 data clears PAGASA's own QC/finalization pipeline — low priority given the small affected share.

## Resolved: delimitation mismatch

The min `D_start` in the labeled population was originally **2010-01-17** — earlier than Chapter 1's declared 2016-2025 historical scope. Investigated and resolved as part of the broader 2026-08-15 data-quality cleanup: traced to 3 confirmed data-entry errors (raw Excel-serial dates 8-13 years before every peer in their own monitoring batch), not a delimitation-text problem. See [[../02-Decisions/D09-Study-Period-Floor]] for the full investigation — the labeled population's `D_start` now runs 2015-01-27 to 2025-12-23.
