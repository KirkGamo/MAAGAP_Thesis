---
tags: [decision, ml-pipeline, data-quality]
status: active
created: 2026-08-08
updated: 2026-08-08
---

# D04: Barangay Veto on the Entity-Resolution Crosswalk

## Context

`build_project_crosswalk()` (`preprocess.py`) links Fund Transfer, Liquidation, and Monitoring rows into one `project_key` via cascading exact/fuzzy match on (project name, municipality, fiscal year). A user-reported bug surfaced two distinct "Public Address System" projects in different Tubungan barangays (Morcillas vs. Balicua), same municipality/year, that had been merged into one `project_key` — the match key didn't check barangay.

## Options considered

1. Leave the match key as-is; treat this as a one-off data anomaly.
2. Add a barangay check that only helps when both sides happen to have clean barangay data, without changing match behavior otherwise.
3. Add a barangay **veto**: reject an otherwise-matching candidate pair if both sides have non-empty, fuzzy-mismatching barangay strings; missing barangay on either side doesn't veto (can't penalize what isn't there).

## Decision

Option 3. `_normalize_barangay()` + `_barangay_conflicts()` (RapidFuzz `token_sort_ratio` < 70 = conflict) added to both the exact-match and fuzzy-match passes of `fuzzy_link_cascading()`.

## Why

Sampling the rejected candidate pairs after implementing this confirmed it wasn't a one-off: generic, frequently-recurring project names ("Streetlights", "Monoblock Chairs", "Socio Cultural Activities") were being matched across genuinely different barangays within the same municipality/year, because the old key wasn't unique enough. This was a systemic, previously-invisible data-quality problem, not a rare edge case. The honest cost: crosswalk linkage dropped from ~35% to ~18.7% — a smaller but *more trustworthy* linked population. This cascaded into a smaller LSTM/meta-learner training population (812/346, down from 1,170/477) — see [[../05-Known-Issues/Issue-Barangay-Canonicalization]] for what's still not fully closed.
