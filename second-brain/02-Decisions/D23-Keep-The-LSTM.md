---
tags: [decision, ml-pipeline, architecture, objective-1, objective-2]
status: active
created: 2026-10-05
updated: 2026-10-05
---

# D23: Keep the LSTM, and report that its contribution is not demonstrable

## Context

Objective 1 specifies a Level 0 stacking ensemble of Random Forest, XGBoost and
LSTM. All three were built. Once [[D21-Two-Learner-Fallback]] made the
two-learner model a first-class scoring path rather than an emergency measure,
a question became unavoidable: **does the LSTM earn its place?**

The stored metrics appear to answer it emphatically, and in the wrong direction:

| | n_test | accuracy | AUC-ROC |
|---|---|---|---|
| three-learner | 598 | 0.8880 | 0.9581 |
| two-learner | 1,765 | 0.9258 | **0.9762** |

**That comparison is confounded and must never be reported as it stands.** The
models are evaluated on different populations. The three-learner can only be
scored where an LSTM sequence exists — 598 of 1,765 test rows — while the
two-learner is scored everywhere. Projects with enough monitoring events to form
a sequence are plausibly a *harder* subpopulation: more site activity, longer
duration, more that can go wrong. The gap may be the sample, not the model.

## The valid comparison

`scripts/compare_meta_learners_same_rows.py` scores both models on the **same
598 rows**, which is the only comparison that isolates the model from the
population:

| metric | three-learner | two-learner | Δ |
|---|---|---|---|
| accuracy | 0.8880 | 0.8997 | +0.0117 |
| precision | 0.8514 | 0.8922 | +0.0408 |
| recall | 0.8760 | 0.8554 | −0.0207 |
| f1 | 0.8635 | 0.8734 | +0.0099 |
| auc_roc | 0.9581 | 0.9528 | −0.0053 |

Small, **mixed in direction**, and a McNemar test on the discordant pairs
(7 vs 14) gives an exact two-sided **p = 0.189**. A paired test is the right
instrument: the models are scored on identical samples, so treating the two
accuracies as independent would discard the pairing and overstate uncertainty.

Figures land in `artifacts/meta_learner_paired_comparison.json`.

## Decision

**Keep the LSTM. Report the null result as a finding about data coverage.**

The honest claim is *"insufficient sequence coverage to demonstrate value"*, not
*"the LSTM does not help"* — and certainly not *"recurrent architectures are
unsuited to this task"*.

### Why not drop it

The case for dropping is real and was taken seriously:

- It participates in a minority of decisions: **72%** of scored projects and
  **76%** of High/Critical run on the two-learner model.
- TensorFlow is **1.5 GB of the 2.3 GB** virtualenv — the largest dependency,
  187 MB of the 335 MB import footprint, and the main driver of image size and
  cold-start time.
- The three/two split created a bug class of its own: the fabricated-LSTM-input
  defect that scored 72% of projects with an invented value, plus the
  `score_basis` provenance machinery and the two-population metrics confusion
  that now has to be explained on the Models page.

It is nonetheless kept, for one decisive reason and two supporting ones.

**The null is underpowered, so removal cannot rest on it.** 598 rows produced
only **21 discordant pairs**. Failing to detect a difference at that sample size
is not evidence that no difference exists. Deleting a component because an
underpowered test returned null is precisely the inference a panel should
challenge.

**Deleting it would destroy the evidence for the claim.** The finding is that
*this dataset* lacks the monitoring-event density to show the LSTM's value —
only ~34% of test rows have a sequence at all. That is a statement about PPDO's
data, and it can only be made by a system that implemented the component and
measured it.

**Objective 1 names the three-learner stack.** Removing it rewrites Chapters 1
and 3 for a result the data does not strongly support in either direction.

## What this separates

The **scientific** conclusion and the **engineering** one are different, and
Chapter 5 should say both:

- *Thesis*: the three-learner ensemble is retained and its marginal
  contribution reported as not demonstrable at the available sequence coverage.
- *Deployment*: a production instance could run two-learner-only at roughly a
  third of the image footprint, at no measurable cost in predictive performance
  — a recommendation that follows from this project's own measurement rather
  than from an attachment to the original design.

## Consequences

- Chapter 4 must report the paired comparison, not the stored per-model metrics,
  whenever the two configurations are compared.
- Wherever the headline ensemble metrics appear (accuracy 88.8%, AUC-ROC 0.958),
  they must be labelled as computed on the 598-row sequence-bearing subset,
  alongside the fact that **76% of deployed High/Critical classifications come
  from the two-learner configuration**. The Models page now shows both with
  their populations and states that they are not comparable.
- Expanding LSTM sequence coverage remains the single highest-value data
  improvement available, and is the condition under which this decision should
  be revisited.

## See also

- [[D21-Two-Learner-Fallback]] — why the two-learner model exists at all
- `scripts/compare_meta_learners_same_rows.py` — reproduces every figure here
