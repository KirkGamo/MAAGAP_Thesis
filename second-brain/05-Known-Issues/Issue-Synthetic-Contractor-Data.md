---
tags: [open-issue, data-availability]
status: active
created: 2026-08-08
updated: 2026-08-08
---

# Open Issue: Synthetic Contractor Data

Contractor features (`historical_delay_rate`, `reliability_score`, `contractor_spec_*`) are active in the feature set, but every value comes from a 150-row synthetic placeholder table ([[../03-ML-Pipeline/Stage2-Synthetic-Data]]) with no real linkage to actual PPDO contractors or PhilGEPS procurement records.

## Why this matters

This is Chapter 1's declared Data Availability limitation, not a bug. These features should be read as exercising the join/feature mechanics — proving the pipeline can incorporate contractor-level signal if it existed — not as real contractor-performance evidence in any current metric.

## What would resolve it

Real contractor-project linkage data. Flagged as a natural next step in [[HANDOFF]].
