---
tags: [open-issue, ml-pipeline, target-variable]
status: active
created: 2026-08-08
updated: 2026-08-08
---

# Open Issue: Unclassified Project Type

19.1% of all monitoring rows (1,674 of 8,784) have `project_type = "Unclassified"` and can therefore **never** be labeled — `T_standard` is undefined without a resolved Infrastructure/Non-Infrastructure category, so `RedFlag` stays NaN for these regardless of how good their completion-date evidence is (this is true even for rows with a perfectly credible direct completion date).

## Why this matters

This is a real ceiling on the labeled population size that no target-construction fix (proxy dates, lag correction, the [[../02-Decisions/D03-Phase8-Clamp|Phase 8 clamp]]) can touch — it's upstream, in [[../03-ML-Pipeline/Stage1-Preprocess|project-type classification]], not in target construction.

## What would resolve it

Improving the project-type classifier's coverage/accuracy at the preprocessing stage. Not currently scoped as active work.
