---
tags: [open-issue, data-availability]
status: active
created: 2026-08-15
updated: 2026-08-15
---

# Open Issue: Climate Data Coverage Gap (2025)

The PAGASA climate data request (real rainfall/wind observations, intended to replace the coarse [[../04-Data-Model/Glossary|is_wet_season_release]] proxy — see `feature_engineering.py`'s `WEATHER_EXTENSION_KEYWORDS`) is capped at 31 December 2024 by PAGASA's own request form, not by choice — the form's End Date field enforces this regardless of what's entered. The raw fund-transfer/monitoring data extends into 2025 (max `D_start` 2025-12-23); no 2026 rows exist yet.

## Why this matters

Real PAGASA data, once received, can only replace the proxy for the portion of the labeled population dated through 2024. Verified against the 5,159-row labeled population (`data/ready/train.csv` + `test.csv`, keyed on `D_start`, no nulls):

- **189 of 5,159 rows (3.66%)** fall in 2025 — all of them, since 2026 has zero rows.
- Evenly split, not concentrated: 134/3,612 train (3.71%) and 55/1,547 test (3.56%) — no stratification concern.
- `is_wet_season_release` already covers these 189 rows as fallback signal, so they aren't left with no weather feature at all, just the coarser one.

At under 4% of the population and split-balanced, this is a footnote-scale caveat for Chapter 1's Data Availability limitation and the methodology report — not something that needs a design change (e.g. dropping 2025 rows, or delaying the PAGASA request). State it plainly rather than either hiding it or over-weighting it.

## What would resolve it

A follow-up PAGASA request once 2025 data clears PAGASA's own QC/finalization pipeline — low priority given the small affected share.

## Aside: delimitation mismatch worth checking

While verifying this, the actual min `D_start` in the labeled population came back as **2010-01-17** — earlier than Chapter 1's declared 2016-2025 historical scope. Not yet investigated further; if this holds up it's a separate, unrelated accuracy issue (either the delimitation text needs updating to match the real data range, or there's a small number of pre-2016 outlier rows worth checking against `PLAUSIBLE_DATE_MIN` in `preprocess.py`).
