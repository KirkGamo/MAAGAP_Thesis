---
tags: [ml-pipeline, stage]
status: active
created: 2026-08-08
updated: 2026-08-08
---

# Stage 1: preprocess.py

Input: the raw source workbook (`Copy of 2022 conso Fund Transfer worksheet (2).xlsx`) — Fund Transfer Con, Liquidation, Monitoring Report Con sheets, plus 20% NTA Monitored / SEF Monitored (folded in later, see below). Output: `data/processed/*.csv`.

## What it does

1. Type coercion (dates, amounts).
2. Entity resolution: `build_project_crosswalk()` links Fund Transfer ↔ Liquidation ↔ Monitoring rows into one `project_key` via cascading exact/fuzzy match on (project name, municipality, fiscal year, **barangay** — see [[../02-Decisions/D04-Barangay-Veto-Crosswalk]]).
3. Categorical normalization (unmapped STATUS/municipality values).
4. Project-type classification (Infrastructure / Non-Infrastructure / Unclassified).

## NTA/SEF folding

20% NTA Monitored (21 usable rows) and SEF Monitored (86 usable rows) sheets are folded into the main monitoring population. Their DATE RELEASED/Year fields are left unset rather than mapped from another column on an unverified equivalence — they rely on the same D_start fallback and imputation as any other row with a missing release date.

## Run only when raw source data changes

This is the slowest, least-frequently-needed stage — see [[../06-Operations/Pipeline-Rerun-Guide]] for exact invocation.
