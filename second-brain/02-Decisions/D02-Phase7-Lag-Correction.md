---
tags: [decision, ml-pipeline, target-variable]
status: active
created: 2026-08-08
updated: 2026-08-08
---

# D02: Empirical Lag Correction (Phase 7)

## Context

[[D01-Proxy-Completion-Dates|Proxy completion dates]] are a systematically late upper bound — the gap showed up starkly as an 82.3% RedFlag rate among proxy-dated rows versus 7.6% among directly-observed rows. Left uncorrected, this would badly overstate how many projects are actually delayed.

## Options considered

1. Leave the bias undocumented in the numbers, just caveat it in prose.
2. Apply a fixed, arbitrary offset.
3. Calibrate the typical lag empirically from rows where BOTH a direct and a proxy date exist, and subtract that from every proxy date before use.

## Decision

Option 3. `compute_empirical_lag_days()` computes the **median** lag (proxy date minus direct date) across the 424 rows with both values present — currently 267.5 days — and every proxy date has that median subtracted before being used as a completion date.

## Why

Median, not mean, because the lag distribution is heavily right-skewed (paperwork delays can be very long outliers) — a mean would be dragged by a handful of extreme cases. This is a real, data-driven correction of a measured bias, not a tuning knob pulled toward a target number. It doesn't fully close the gap (a median-based correction removes the typical bias, not every project's individual lag — post-correction, proxy rows still show ~53.5% RedFlag vs. 7.6% direct), and it introduced its own side effect: subtracting a fixed 267.5 days from every proxy date occasionally pushes a *short-duration* project's corrected date to before its own D_start, which is not credible. That side effect is what [[D03-Phase8-Clamp]] addresses.
