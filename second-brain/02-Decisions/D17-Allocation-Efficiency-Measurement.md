---
tags: [decision, optimization, objective-4, evaluation]
status: active
created: 2026-09-13
updated: 2026-09-13
---

# D17: Allocation Efficiency Measurement — and why the 15% claim is not supported

## Context

Objective 4 commits to "at least a 15% improvement in allocation efficiency compared to current manual approaches through simulated project scenarios". Chapter 3 additionally promised expert feasibility review and Monte Carlo robustness testing.

Before this work, none of the measurement existed: no efficiency metric was defined anywhere in the repository, no baseline was defined, and no simulation existed. The PuLP program solved to `Optimal` and reported coverage, but coverage is not efficiency and nothing compared it to anything. The 15% figure was unfalsifiable.

## What was built

- **`allocation_efficiency()`** in `optimization_engine.py` — total risk weight of visited projects divided by inspector-days consumed. Fixed *before* any comparison was run.
- **Three greedy baselines** in `allocation_evaluation.py` — `sequential`, `random`, `risk_ranked` — all enforcing the optimizer's exact feasibility rules (capacity, one cluster per inspector-day, vehicles, budget), differing only in ordering and absence of lookahead.
- **A scenario sweep** across capacity levels, reporting improvement as a function of demand-to-capacity ratio.
- **Monte Carlo** perturbing each meta-learner probability (re-tiered) and each inspector's weekly availability.

## Two defects found by measuring

**1. The optimizer was 25% WORSE than every baseline on first measurement.** Its objective had no term for inspector-days consumed. Once coverage saturates, nothing distinguished covering 25 projects in 9 inspector-days from covering the same 25 in 12 — while greedy first-fit packs days tight as a side effect of placement order. Fixed by adding `INSPECTOR_DAY_PENALTY` against the already-present deployed indicator `Σ_c y[i][d][c]`.

The metric was **not** changed. It had been declared in advance precisely so this case would resolve by fixing the optimizer.

**2. `risk_ranked` was mis-specified as "manual practice".** It orders by `meta_prob` — MAAGAP's own model output. PPDO has no risk model, so no planner there can produce that ordering. It is a counterfactual in which a planner already holds MAAGAP's predictions, not a model of current practice. `sequential` and `random` need no model and are what Objective 4's phrase denotes.

The declared headline baseline was **not** switched after seeing that `sequential` gave a better number. Both are reported, with each baseline's information set recorded explicitly.

## Results

Deterministic sweep, live 25-project candidate pool:

| Inspectors | demand/capacity | vs sequential | vs random | vs risk_ranked |
|---|---|---|---|---|
| 1 | 1.67 | +25.0% | +33.3% | +0.0% |
| 2 | 0.83 | +3.1% | +14.6% | +0.0% |
| 3 | 0.56 | +0.0% | +0.0% | +0.0% |
| 4 | 0.42 | +0.0% | +0.0% | +0.0% |
| 6 | 0.28 | +0.0% | +0.0% | +0.0% |

Monte Carlo, 40 replications at 2 inspectors, probabilities perturbed (σ=0.05) and inspectors absent at 10%:

| Baseline | mean | median | 90% interval | share ≥ 15% |
|---|---|---|---|---|
| sequential | +4.8% | +3.2% | [−6.9%, +16.4%] | 22.5% |
| random | +7.1% | +3.5% | [−8.2%, +25.0%] | 10.0% |
| risk_ranked | +8.6% | +11.1% | [−0.5%, +25.0%] | 12.5% |

## Decision

**Objective 4's 15% claim is not supported by measurement and should not be asserted.**

The improvement is positive on average but small, highly variable, and clears 15% in only 10–22.5% of replications. Every 90% interval includes zero or near-zero at its lower bound. The +25%/+33% figures exist at exactly one deterministic point — a single inspector against 25 projects — and are not robust.

Three findings stand behind that:

1. **Improvement is a function of scarcity, not a constant.** Once capacity is slack, every allocator scores identically because everything gets visited regardless of how it is allocated. Quoting any single improvement number without its demand-to-capacity ratio is meaningless.

2. **The measurable efficiency gain comes from risk prioritization, i.e. the predictive half of MAAGAP — not from the integer program.** Under perturbation the LP does add something over `risk_ranked` (+8.6% mean), but the interval straddles zero.

3. **What the integer program actually contributes is certified optimality and declarative constraint handling** — budget, vehicles, geography — which a greedy heuristic satisfies only by construction and cannot be shown to satisfy optimally. That is a real contribution and worth defending. It is not an efficiency contribution.

## The measurement is coverage-limited, and this matters

The candidate pool is 25 projects because only 25 ongoing projects currently have both a scoreable tabular row and a matching LSTM sequence. `inference.csv` holds 2,393 rows and 668 are scored live. PPDO's real monitoring workload is far larger than 25 projects a week.

**The evaluation therefore runs in a capacity-slack regime created by the meta-learner's coverage limitation, not by PPDO's actual workload.** If the scoreable pool grew toward the real portfolio, demand-to-capacity would rise well above 1.0 — the regime where the sweep shows the optimizer earning +25% or more. Improving LSTM sequence coverage is therefore not only a modeling improvement; it is a precondition for the optimizer to demonstrate value.

## Options for the manuscript

1. **Amend Objective 4** to claim what is measured: improvement conditional on capacity scarcity, with the attribution to risk prioritization stated. Honest, defensible, and a stronger result than a bare percentage because it says *when* and *why* the method helps.
2. **Re-measure once LSTM coverage improves**, if the candidate pool grows enough to put demand-to-capacity above 1.0 in the live system rather than only in simulation.
3. **Keep the 15% target as a stated target and report the shortfall** with this analysis as the discussion.

Options 1 and 3 are compatible and are the recommended pair. Option 2 is a genuine future-work item, not something to wait for.

**This requires an adviser decision before Chapter 4 is written.**

## Related

- [[D08-SHAP-Explainability]] — the other Objective-4-adjacent commitment
- [[../05-Known-Issues/Issue-LSTM-Low-Precision]] — the coverage limitation that makes the candidate pool small
- `ml-service/allocation_evaluation.py` — the implementation
- `ml-service/artifacts/allocation_efficiency_evaluation.json` — the recorded results
