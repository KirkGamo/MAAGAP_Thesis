---
tags: [decision, ml-pipeline, objective-4, coverage]
status: active
created: 2026-09-29
updated: 2026-09-29
---

# D21: Two-learner fallback — and the recovery of Objective 4

## Context

[[D17-Allocation-Efficiency-Measurement]] concluded that Objective 4's 15% claim was unsupported: the improvement averaged 4.8–8.6% with every 90% interval touching zero, clearing 15% in only 10–22.5% of replications.

It also identified *why*, and flagged it as the thing to fix: only **25 of 2,393 ongoing projects** reached the candidate pool, so the scheduling problem sat permanently in a capacity-slack regime where every allocator ties because everything gets visited regardless.

This decision removes that constraint and re-measures.

## The cause, diagnosed rather than assumed

D17 attributed the gap to "LSTM coverage". The real mechanism is narrower and more fixable.

A meta-learner score required all three base learners. LSTM sequences are built by iterating the **fund-transfer crosswalk**, so a monitoring row the crosswalk could not link to a fund-transfer row is keyed `MON_ONLY_<mon_row_id>` and never receives one. That was 1,725 of 2,393 ongoing projects.

**Sequences were never scarce: 19,327 exist.** The bottleneck was how project identity is assembled, not sequence data — a downstream consequence of [[D04-Barangay-Veto-Crosswalk]]'s deliberately conservative linkage rate.

And the excluded rows are not poor quality. Measured against the scoreable ones, they match on every tabular feature:

| Feature | MON_ONLY | scoreable |
|---|---|---|
| `AMOUNT (Php)` | 100% | 100% |
| `D_start` | 99.6% | 100% |
| `rain_total_mm_180d` | 99.5% | 99.9% |
| `project_type` | 100% | 100% |
| resolvable municipality | 99.8% | — |

They were being discarded for how their keys were built, not for anything about the projects.

## The fix

A second meta-learner on the two tabular base learners alone, trained on the **full OOF set (4,119 rows** versus 1,451 for the three-learner model), applied only where no sequence exists. The scoring join becomes a LEFT join, and every row carries `score_basis` of `three_learner` or `two_learner` so provenance is explicit.

**Sequences are deliberately not fabricated.** A `MON_ONLY` row is a single monitoring observation; any sequence built for it would be one event of padding. Feeding that to an LSTM manufactures input rather than recovering information.

## Does the LSTM earn its place?

Compared on the **same 598 test rows**, so the two are actually comparable:

| Model | AUC | accuracy | F1 |
|---|---|---|---|
| three-learner | **0.9597** | 0.8946 | 0.8706 |
| two-learner | 0.9543 | **0.9030** | **0.8771** |
| LSTM alone | 0.7159 | — | — |

The LSTM adds **+0.0054 AUC** while costing 0.0084 accuracy and 0.0065 F1. It is retained where available — Objective 1 specifies the three-learner architecture, and it does help ranking — but restricting scoring coverage to LSTM-covered rows was never a good trade for +0.005 AUC.

## Effect on the optimizer

| | before | after |
|---|---|---|
| Scored ongoing projects | 668 | **2,393** |
| High/Critical candidates | 25 | **87** |
| Projects scheduled | 20 | 60 |
| Coverage rate | 100% | **69%** |
| Inspector-days used | 9 | 20 |
| Allocation efficiency | 4.722 | **7.425** |
| Budget utilization | 38.9% | **99.6%** |

The weekly budget now binds at 99.6% and **27 High/Critical projects cannot be visited**. The resource is genuinely scarce for the first time.

## Objective 4, re-measured

Monte Carlo, 30 replications at 2 inspectors, probabilities perturbed and availability sampled — the same protocol D17 used:

| Baseline | mean | median | 90% interval | share ≥ 15% |
|---|---|---|---|---|
| `sequential` (no model) | **+29.4%** | +28.2% | [+25.0%, +35.1%] | **100%** |
| `random` (no model) | **+40.4%** | +41.7% | [+26.6%, +51.5%] | **100%** |
| `risk_ranked` (model-equipped) | **+22.1%** | +25.0% | [+12.5%, +25.0%] | **76.7%** |

Point comparison on the full six-inspector roster: **+18.8%** against both `sequential` and `risk_ranked`, +40.1% against `random`.

Scenario sweep, improvement against the strongest baseline as scarcity varies:

| Inspectors | demand/capacity | vs risk_ranked |
|---|---|---|
| 1 | 5.80 | +25.0% |
| 2 | 2.90 | +25.0% |
| 3 | 1.93 | +25.0% |
| 4 | 1.45 | +12.5% |
| 6 | 0.97 | +4.4% |

**Objective 4's 15% target is met**, including against the model-equipped counterfactual, where the 90% interval's lower bound is now +12.5% rather than touching zero.

## What changed, stated precisely

**The method did not change. The measurement regime did.**

D17 was not wrong. It correctly measured a system in which the optimizer could not demonstrate value, and correctly identified why. Removing that constraint — and only that constraint — moved the same optimizer from +4.8% to +29.4% against current practice.

That is a stronger result than a large number obtained on the first attempt would have been, because the mechanism is understood: optimization pays when the resource is scarce, and the resource only *appeared* abundant because 72% of the portfolio was invisible to the scorer.

It also means Objective 4's finding should be reported with its condition attached, exactly as the amended objective now words it: improvement measured across scenarios of varying scarcity, reported as a distribution.

## Caveats that must travel with this result

- **1,725 of the 2,393 scored projects (72%) now carry two-learner scores.** The risk tiers driving the optimizer are therefore substantially produced by a two-input model. This is disclosed via `score_basis` and must be stated in Chapter 4 rather than left implicit.
- The improvement is **conditional on scarcity**: it falls to +4.4% at the full six-inspector roster where demand/capacity is 0.97.
- Cost parameters remain [[D18-Geographic-Distance-Costing]]'s flagged placeholders, and the budget is now the binding constraint — so the figures above are more sensitive to those placeholders than before, not less. Confirming them with PPDO is now higher priority.

## Related

- [[D17-Allocation-Efficiency-Measurement]] — the measurement this supersedes, and which identified the cause
- [[D18-Geographic-Distance-Costing]] — the cost model the now-binding budget uses
- [[../05-Known-Issues/Issue-LSTM-Low-Precision]] — narrowed, not closed: coverage is addressed, precision is not
