---
tags: [open-issue, data-availability]
status: active
created: 2026-08-15
updated: 2026-08-15
---

# Open Issue: Climate Data Coverage Gap (2025-2026)

The PAGASA climate data request (real rainfall/wind observations, intended to replace the coarse [[../04-Data-Model/Glossary|is_wet_season_release]] proxy — see `feature_engineering.py`'s `WEATHER_EXTENSION_KEYWORDS`) is capped at 31 December 2024 by PAGASA's own request form, not by choice — the form's End Date field enforces this regardless of what's entered. The raw fund-transfer/monitoring data extends into 2025-2026.

## Why this matters

Real PAGASA data, once received, can only replace the proxy for the portion of the labeled population dated 2016-2024. Rows dated 2025-2026 keep `is_wet_season_release` (a release-month-based boolean) as their only weather signal — the eventual climate feature will not be uniformly "real" across the full historical span, and that asymmetry needs disclosing in Chapter 1's Data Availability limitation and the methodology report, not glossed over as if every row got the same treatment.

**Exact scope: pending verification.** Not yet quantified how many labeled rows (out of the 5,159-row resolved population per [[HANDOFF]]) fall in 2025-2026, or whether they concentrate in train or test.

## What would resolve it

Either a follow-up PAGASA request once 2025 (and later 2026) data clears PAGASA's own QC/finalization pipeline, or — more immediately — quantifying the affected row count and stating the partial-coverage caveat explicitly in the manuscript.
