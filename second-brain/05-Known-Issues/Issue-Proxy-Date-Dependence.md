---
tags: [open-issue, ml-pipeline, methodology]
status: active
created: 2026-08-08
updated: 2026-08-08
---

# Open Issue: Proxy-Date Dependence

Roughly 94% of the labeled population (5,159 rows) relies on a recovered proxy completion date, not a directly observed one (only 330 rows have a direct `Date of Completion`). See [[../02-Decisions/D01-Proxy-Completion-Dates]].

## Why this matters

Every reported metric — RedFlag positive rate, Level 0/1 accuracy/precision/recall — should be read as "ensemble performance under the current proxy-date methodology," not a bias-free measurement against ground truth. The [[../02-Decisions/D02-Phase7-Lag-Correction|lag correction]] and [[../02-Decisions/D03-Phase8-Clamp|clamp]] reduce but do not eliminate this: post-correction, proxy-dated rows still show a materially higher RedFlag rate (~53.5%) than directly-observed rows (7.6%).

## What would actually resolve this

Real, systematically-collected completion dates for a larger share of PPDO's project history — not something fixable from within the current dataset. Worth stating plainly at defense as an inherent data-availability constraint, not something the modeling methodology failed to address.
