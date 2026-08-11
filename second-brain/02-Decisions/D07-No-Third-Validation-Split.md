---
tags: [decision, ml-pipeline, methodology]
status: active
created: 2026-08-08
updated: 2026-08-08
---

# D07: No Separate Validation Split

## Context

Standard practice often calls for a 70/15/15 train/validation/test split. Given how small the resolved population already is before any further split (see [[D01-Proxy-Completion-Dates]] and [[../05-Known-Issues/Issue-Proxy-Date-Dependence]]), carving out a third partition shrinks an already-constrained training set further.

## Decision

70/30 train/test at the project level, with 5-fold stratified out-of-fold (OOF) cross-validation on the training split filling the role a separate validation set would — for both Level 0 base-learner training and Level 1 meta-learner input generation (the meta-learner trains on OOF probabilities, never on a base learner's in-sample predictions, which would leak information).

## Why

This is a deliberate, documented design choice, not an oversight — worth stating explicitly if asked "why not 70/15/15" at defense. OOF cross-validation gives an honest, non-leaked estimate of base-learner performance without sacrificing training data to a static holdout. Splitting is done at the *project* level (`project_key`), not the row level, so a single project's records can never appear on both sides of the split.
