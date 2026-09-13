"""
MAAGAP — Allocation efficiency evaluation (Objective 4's 15% claim)
================================================================================
Measures the optimizer against manual-practice baselines on a fixed,
pre-declared efficiency metric, and reports the improvement as a DISTRIBUTION
over Monte Carlo replications rather than a single point estimate.

WHY THIS EXISTS
------------------------------------------------------------------------------
Objective 4 states that success "will be measured by demonstrating at least a
15% improvement in allocation efficiency compared to current manual approaches
through simulated project scenarios", and Chapter 3's Optimization Evaluation
section additionally promises expert feasibility review and Monte Carlo
robustness testing. The PuLP program existed and solved; none of the
measurement did. No baseline was defined anywhere, no efficiency metric was
defined anywhere, and no simulation existed. The 15% figure was therefore
unfalsifiable — the single most attackable claim in the study.

WHAT "ALLOCATION EFFICIENCY" MEANS HERE
------------------------------------------------------------------------------
Defined once, in optimization_engine.allocation_efficiency(), as

    efficiency = (total risk weight of projects visited) / (inspector-days used)

i.e. how much monitoring risk is retired per inspector-day spent. The scarce
resource in this problem is inspector time, not project count, and visiting one
Critical project is genuinely worth more than visiting one High project — which
a raw coverage rate cannot express.

It was fixed BEFORE any comparison was run. That ordering is the point: a
metric chosen after seeing which one flattered the optimizer would prove
nothing.

WHAT THE BASELINES ARE, AND WHY THEY ARE NOT STRAW MEN
------------------------------------------------------------------------------
All three baselines assign visits greedily in a given order, placing each
project in the first slot where it fits. Critically, they respect the SAME
feasibility constraints as the optimizer — daily and weekly capacity, one
cluster per inspector-day, the vehicle pool, and the weekly budget. A schedule
violating those is not executable, so allowing a baseline to violate them would
manufacture an advantage for the optimizer rather than measure one.

What the baselines lack is not feasibility but lookahead: they commit to each
placement in turn without considering how it constrains later ones, which is
what a human planner with a list and a calendar actually does.

    sequential   — candidate-pool order, no risk prioritization. Models
                   first-come-first-served handling of a monitoring list.
    random       — shuffled order, averaged over replications. Guards against
                   the sequential ordering being accidentally favourable.
    risk_ranked  — highest predicted risk first, but no geographic or capacity
                   lookahead. The strongest baseline, and the conservative
                   comparison.

TWO COMPARISONS, NOT ONE — AND WHY BOTH MUST BE REPORTED
------------------------------------------------------------------------------
`risk_ranked` orders by meta_prob, which is MAAGAP's own model output. PPDO has
no risk model today, so no planner there can produce that ordering. It is
therefore NOT a model of current manual practice; it is a counterfactual in
which a planner already holds MAAGAP's predictions and allocates them by hand.
`sequential` and `random` need no model, and are what allocating a monitoring
list without predictive support actually looks like.

Measured across capacity levels, the two comparisons answer different
questions and give different answers:

  - Against current practice (no model), where capacity binds, the optimizer
    improves allocation efficiency by roughly 25-33%, clearing the 15% target.
  - Against the model-equipped counterfactual, it improves it by 0%.

Read together, those say the measurable efficiency gain comes from RISK
PRIORITIZATION — that is, from the predictive half of MAAGAP — and not from
the integer program. What the integer program contributes is certified
optimality and declarative handling of budget, vehicle and geographic
constraints that a greedy heuristic satisfies only by construction and cannot
be shown to satisfy optimally. That is a real contribution, but it is not an
efficiency contribution, and this module reports it as what it is.

A third finding constrains both: when capacity is SLACK — as it is on the live
25-project candidate pool against roughly 60 schedulable visit slots — every
allocator scores identically, because everything gets visited regardless. The
improvement figures above exist only in the constrained regime, which is why
scenario_sweep() reports improvement as a function of demand-to-capacity ratio
rather than quoting a single number.

Quoting only the largest of these figures would be the easiest way to
manufacture a result above 15%, and the least defensible at a panel.

*** PPDO CONFIRMATION STILL REQUIRED ***
------------------------------------------------------------------------------
These three are *models* of manual practice inferred from how such lists are
typically worked, NOT an elicited description of PPDO's actual procedure. The
stronger evidence — reconstructing real historical deployment from monitoring
visit records, or a procedure described directly by PPDO staff — should replace
or corroborate them. Until it does, report these results as "against modelled
manual practice", never as "against PPDO's current practice".

Usage
-----
    python allocation_evaluation.py --replications 200
    python allocation_evaluation.py --candidates-csv artifacts/allocation_candidates.csv
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
from pathlib import Path
from typing import Callable, Optional

os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "3")

import numpy as np
import pandas as pd

THIS_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(THIS_DIR))
sys.path.insert(0, str(THIS_DIR / "models"))

from optimization_engine import (  # noqa: E402
    ARTIFACTS_DIR,
    CLUSTER_MOBILIZATION_COST_PHP,
    DAILY_CAPACITY,
    INSPECTOR_IDS,
    RISK_WEIGHTS,
    VEHICLE_COUNT,
    VISIT_COST_PHP,
    WEEKLY_CAPACITY,
    WEEKLY_FIELD_BUDGET_PHP,
    WORKDAYS,
    allocation_efficiency,
    build_and_solve_schedule,
)
from common.risk_tiers import probability_to_risk_tier  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("allocation_evaluation")

CANDIDATES_CACHE = ARTIFACTS_DIR / "allocation_candidates.csv"
RESULTS_PATH = ARTIFACTS_DIR / "allocation_efficiency_evaluation.json"


# ---------------------------------------------------------------------------
# Greedy manual-practice baselines
# ---------------------------------------------------------------------------

def greedy_allocate(
    priority_df: pd.DataFrame,
    order: list[int],
    inspectors: list[str] = INSPECTOR_IDS,
    days: list[str] = WORKDAYS,
    daily_capacity: int = DAILY_CAPACITY,
    weekly_capacity: int = WEEKLY_CAPACITY,
    vehicle_count: int = VEHICLE_COUNT,
    weekly_budget_php: float = WEEKLY_FIELD_BUDGET_PHP,
    visit_cost_php: float = VISIT_COST_PHP,
    cluster_cost_php: float = CLUSTER_MOBILIZATION_COST_PHP,
) -> pd.DataFrame:
    """
    Places each project, in the given order, into the first feasible
    (inspector, day) slot. Enforces exactly the optimizer's feasibility rules,
    so the two produce schedules from the same feasible set and differ only in
    decision procedure.
    """
    day_cluster: dict[tuple[str, str], str] = {}   # (inspector, day) -> cluster committed
    day_count: dict[tuple[str, str], int] = {}     # (inspector, day) -> visits placed
    week_count: dict[str, int] = {i: 0 for i in inspectors}
    day_vehicles: dict[str, set[str]] = {d: set() for d in days}
    cluster_weeks: set[tuple[str, str]] = set()    # (inspector, cluster) mobilizations
    rows: list[dict] = []
    cost = 0.0

    for idx in order:
        row = priority_df.iloc[idx]
        cluster = row["cluster"]
        placed = False
        for d in days:
            if placed:
                break
            for i in inspectors:
                if day_count.get((i, d), 0) >= daily_capacity:
                    continue
                if week_count[i] >= weekly_capacity:
                    continue
                committed = day_cluster.get((i, d))
                if committed is not None and committed != cluster:
                    continue  # one cluster per inspector-day
                if i not in day_vehicles[d] and len(day_vehicles[d]) >= vehicle_count:
                    continue  # no vehicle free that day

                incremental = visit_cost_php + (
                    cluster_cost_php if (i, cluster) not in cluster_weeks else 0.0
                )
                if cost + incremental > weekly_budget_php:
                    continue

                day_cluster[(i, d)] = cluster
                day_count[(i, d)] = day_count.get((i, d), 0) + 1
                week_count[i] += 1
                day_vehicles[d].add(i)
                cluster_weeks.add((i, cluster))
                cost += incremental
                rows.append({
                    "inspector": i,
                    "day": d,
                    "project_key": row["project_key"],
                    "project_name": row["project_name"],
                    "municipality": row["municipality"],
                    "cluster": cluster,
                    "risk_tier": row["risk_tier"],
                    "meta_prob": round(float(row["meta_prob"]), 4),
                })
                placed = True
                break

    return pd.DataFrame(rows)


def order_sequential(priority_df: pd.DataFrame, rng: np.random.Generator) -> list[int]:
    return list(range(len(priority_df)))


def order_random(priority_df: pd.DataFrame, rng: np.random.Generator) -> list[int]:
    return list(rng.permutation(len(priority_df)))


def order_risk_ranked(priority_df: pd.DataFrame, rng: np.random.Generator) -> list[int]:
    return list(priority_df["meta_prob"].to_numpy().argsort()[::-1])


BASELINES: dict[str, Callable[[pd.DataFrame, np.random.Generator], list[int]]] = {
    "sequential": order_sequential,
    "random": order_random,
    "risk_ranked": order_risk_ranked,
}

# WHICH BASELINES REPRESENT CURRENT PRACTICE, AND WHICH DO NOT
# ---------------------------------------------------------------------------
# This distinction was not drawn when the baselines were first specified, and
# drawing it changes how the results must be read.
#
# `risk_ranked` orders projects by meta_prob — MAAGAP's own model output. PPDO
# has no risk model today, so a planner there cannot produce that ordering. It
# is therefore NOT a model of current manual practice; it is a counterfactual
# in which a planner already has MAAGAP's predictions and allocates by hand.
#
# `sequential` and `random` require no model. They are what allocating a
# monitoring list without predictive support actually looks like, and they are
# the comparison Objective 4's phrase "current manual approaches" denotes.
#
# Both comparisons are reported. Against current practice the question is
# whether MAAGAP helps at all; against the model-equipped counterfactual the
# question is what the integer program contributes over simply sorting by the
# model's output. Reporting only one of the two would misstate the result in
# whichever direction that one flattered.
BASELINE_INFORMATION_SETS = {
    "sequential": "no model — represents current manual practice",
    "random": "no model — represents current manual practice",
    "risk_ranked": "uses MAAGAP predictions — counterfactual, not current practice",
}

# Declared before measurement and deliberately left unchanged: the most
# conservative comparison, against the strongest baseline.
HEADLINE_BASELINE = "risk_ranked"

# The comparison that answers Objective 4's actual wording.
PRACTICE_BASELINE = "sequential"


# ---------------------------------------------------------------------------
# One comparison
# ---------------------------------------------------------------------------

def compare_once(
    priority_df: pd.DataFrame,
    rng: np.random.Generator,
    inspectors: list[str] = INSPECTOR_IDS,
) -> Optional[dict]:
    """Solve the optimizer and every baseline on one candidate pool, returning
    each one's efficiency and the optimizer's improvement over it."""
    try:
        schedule_df, summary = build_and_solve_schedule(priority_df, inspectors=inspectors)
    except ValueError as exc:
        logger.warning("Solver could not run on this replication: %s", exc)
        return None

    opt_eff = allocation_efficiency(schedule_df)
    if opt_eff is None:
        return None

    result = {
        "optimizer_efficiency": opt_eff,
        "optimizer_visits": int(len(schedule_df)),
        "optimizer_status": summary["solver_status"],
        "baselines": {},
    }
    for name, order_fn in BASELINES.items():
        base_df = greedy_allocate(priority_df, order_fn(priority_df, rng), inspectors=inspectors)
        base_eff = allocation_efficiency(base_df)
        result["baselines"][name] = {
            "efficiency": base_eff,
            "visits": int(len(base_df)),
            "improvement": (
                round((opt_eff - base_eff) / base_eff, 4) if base_eff else None
            ),
        }
    return result


# ---------------------------------------------------------------------------
# Monte Carlo
# ---------------------------------------------------------------------------

def perturb(
    priority_df: pd.DataFrame,
    rng: np.random.Generator,
    prob_sigma: float,
) -> pd.DataFrame:
    """
    Re-samples each project's meta-learner probability under Gaussian noise and
    re-derives its tier and risk weight, so a replication reflects a portfolio
    the models might plausibly have scored instead of the one they did.
    Probabilities are clipped into [0, 1] — the tier function rejects anything
    outside it rather than assigning a tier by fall-through.
    """
    out = priority_df.copy()
    noisy = out["meta_prob"].to_numpy() + rng.normal(0.0, prob_sigma, len(out))
    noisy = np.clip(noisy, 0.0, 1.0)
    out["meta_prob"] = noisy
    out["risk_tier"] = [probability_to_risk_tier(p) for p in noisy]
    out["risk_weight"] = out["risk_tier"].map(RISK_WEIGHTS).fillna(0.0)
    # Projects that fall out of High/Critical are no longer schedulable
    # candidates, exactly as select_priority_projects() would treat them.
    return out[out["risk_weight"] > 0].reset_index(drop=True)


def sample_inspectors(rng: np.random.Generator, absence_rate: float) -> list[str]:
    """Each inspector is independently unavailable for the week with
    probability `absence_rate` (leave, illness, reassignment). At least one
    inspector always remains."""
    available = [i for i in INSPECTOR_IDS if rng.random() >= absence_rate]
    return available or [INSPECTOR_IDS[0]]


def monte_carlo(
    priority_df: pd.DataFrame,
    replications: int,
    prob_sigma: float,
    absence_rate: float,
    seed: int,
    inspector_count: int = 2,
) -> dict:
    """
    Replicated comparison under uncertainty.

    `inspector_count` defaults to 2 rather than the full roster of 6 because
    the scenario sweep shows every allocator scoring identically once capacity
    is slack: 25 candidates against ~60 visit slots means everything is visited
    regardless of how it is allocated, and a Monte Carlo run there would
    faithfully report 0% several hundred times while measuring nothing. Two
    inspectors puts demand and capacity near parity, which is the regime in
    which allocation decisions have consequences — and is also the realistic
    one, since the live portfolio is far larger than the 25 projects currently
    scoreable end-to-end.
    """
    rng = np.random.default_rng(seed)
    per_baseline: dict[str, list[float]] = {name: [] for name in BASELINES}
    optimizer_eff: list[float] = []
    skipped = 0

    for r in range(replications):
        pool = perturb(priority_df, rng, prob_sigma)
        if pool.empty:
            skipped += 1
            continue
        available = sample_inspectors(rng, absence_rate)[:inspector_count]
        outcome = compare_once(pool, rng, inspectors=available or [INSPECTOR_IDS[0]])
        if outcome is None:
            skipped += 1
            continue
        optimizer_eff.append(outcome["optimizer_efficiency"])
        for name, entry in outcome["baselines"].items():
            if entry["improvement"] is not None:
                per_baseline[name].append(entry["improvement"])
        if (r + 1) % 25 == 0:
            logger.info("  replication %d/%d", r + 1, replications)

    def describe(values: list[float]) -> dict:
        if not values:
            return {"n": 0}
        arr = np.array(values, dtype=float)
        return {
            "n": int(arr.size),
            "mean_improvement": round(float(arr.mean()), 4),
            "median_improvement": round(float(np.median(arr)), 4),
            "p05": round(float(np.percentile(arr, 5)), 4),
            "p95": round(float(np.percentile(arr, 95)), 4),
            "share_meeting_15pct_target": round(float((arr >= 0.15).mean()), 4),
        }

    return {
        "inspector_count": inspector_count,
        "replications_requested": replications,
        "replications_skipped": skipped,
        "prob_sigma": prob_sigma,
        "inspector_absence_rate": absence_rate,
        "optimizer_efficiency_mean": (
            round(float(np.mean(optimizer_eff)), 4) if optimizer_eff else None
        ),
        "improvement_over": {name: describe(vals) for name, vals in per_baseline.items()},
    }


# ---------------------------------------------------------------------------
# Scenario sweep — where does optimization actually pay?
# ---------------------------------------------------------------------------

def scenario_sweep(
    priority_df: pd.DataFrame,
    inspector_counts: list[int],
    vehicle_counts: Optional[list[int]] = None,
) -> list[dict]:
    """
    Runs the optimizer and the baselines across a range of capacity levels.

    WHY THIS EXISTS, AND WHY A SINGLE NUMBER WAS NOT ENOUGH
    ----------------------------------------------------------------------
    On the live candidate pool the optimizer and all three baselines score
    IDENTICALLY: 25 candidate projects against roughly 60 schedulable visit
    slots means the resource is not scarce, everything gets visited either
    way, and there is nothing left to optimize. An improvement figure measured
    only there would report 0% and say nothing about the method.

    Optimization can only add value when capacity binds. Objective 4 calls for
    measurement "through simulated project scenarios", and this is that: hold
    the real pool's tier mix, cluster distribution and risk weights fixed, and
    vary the inspector and vehicle capacity so that the ratio of demand to
    capacity sweeps from slack to severely constrained.

    Reporting improvement as a function of scarcity is a stronger result than a
    single number would have been, because it states the condition under which
    the method helps instead of implying it always does.
    """
    results = []
    for n_inspectors in inspector_counts:
        inspectors = INSPECTOR_IDS[:n_inspectors]
        vehicles = min(n_inspectors, (vehicle_counts or [VEHICLE_COUNT])[0])
        capacity = n_inspectors * len(WORKDAYS) * DAILY_CAPACITY
        try:
            schedule_df, summary = build_and_solve_schedule(
                priority_df, inspectors=inspectors, vehicle_count=vehicles,
                weekly_budget_php=10_000_000.0,
            )
        except ValueError as exc:
            logger.warning("  %d inspectors: solver could not run (%s)", n_inspectors, exc)
            continue

        opt_eff = allocation_efficiency(schedule_df)
        rng = np.random.default_rng(42)
        entry = {
            "inspectors": n_inspectors,
            "vehicles": vehicles,
            "nominal_visit_capacity": capacity,
            "candidates": int(len(priority_df)),
            "demand_to_capacity": round(len(priority_df) / capacity, 3),
            "optimizer_efficiency": opt_eff,
            "optimizer_visits": int(len(schedule_df)),
            "optimizer_risk_weight": round(
                float(schedule_df["risk_tier"].map(RISK_WEIGHTS).fillna(0).sum()), 2
            ) if not schedule_df.empty else 0.0,
            "baselines": {},
        }
        for name, order_fn in BASELINES.items():
            base_df = greedy_allocate(
                priority_df, order_fn(priority_df, rng), inspectors=inspectors,
                vehicle_count=vehicles, weekly_budget_php=10_000_000.0,
            )
            base_eff = allocation_efficiency(base_df)
            entry["baselines"][name] = {
                "efficiency": base_eff,
                "visits": int(len(base_df)),
                "risk_weight": round(
                    float(base_df["risk_tier"].map(RISK_WEIGHTS).fillna(0).sum()), 2
                ) if not base_df.empty else 0.0,
                "improvement": (
                    round((opt_eff - base_eff) / base_eff, 4)
                    if (base_eff and opt_eff is not None) else None
                ),
            }
        results.append(entry)
        logger.info(
            "  %d inspectors (demand/capacity %.2f): optimizer eff %.4f vs risk_ranked %.4f "
            "-> %+.1f%%",
            n_inspectors, entry["demand_to_capacity"], opt_eff or 0.0,
            entry["baselines"][HEADLINE_BASELINE]["efficiency"] or 0.0,
            100 * (entry["baselines"][HEADLINE_BASELINE]["improvement"] or 0.0),
        )
    return results


# ---------------------------------------------------------------------------
# Candidate pool
# ---------------------------------------------------------------------------

def load_candidates(candidates_csv: Optional[Path]) -> pd.DataFrame:
    """Loads a cached candidate pool, or scores the live ongoing population once
    and caches it. Scoring pulls in TensorFlow and takes minutes; the Monte
    Carlo needs the pool hundreds of times, so it is paid exactly once."""
    path = candidates_csv or CANDIDATES_CACHE
    if path.exists():
        logger.info("Loading cached candidate pool from %s", path)
        return pd.read_csv(path)

    logger.info("No cached pool at %s — scoring the ongoing population.", path)
    from optimization_engine import score_ongoing_projects, select_priority_projects

    priority_df = select_priority_projects(score_ongoing_projects())
    path.parent.mkdir(parents=True, exist_ok=True)
    priority_df.to_csv(path, index=False)
    logger.info("Cached %d candidates to %s", len(priority_df), path)
    return priority_df


def run(
    candidates_csv: Optional[Path],
    replications: int,
    prob_sigma: float,
    absence_rate: float,
    seed: int,
    output: Path,
) -> dict:
    priority_df = load_candidates(candidates_csv)
    logger.info("Candidate pool: %d projects.", len(priority_df))

    logger.info("Point comparison on the unperturbed pool ...")
    point = compare_once(priority_df, np.random.default_rng(seed))

    logger.info("Scenario sweep across capacity levels ...")
    sweep = scenario_sweep(priority_df, inspector_counts=[1, 2, 3, 4, 6])

    logger.info("Monte Carlo: %d replications ...", replications)
    mc = monte_carlo(priority_df, replications, prob_sigma, absence_rate, seed)

    results = {
        "baseline_information_sets": BASELINE_INFORMATION_SETS,
        "practice_baseline": PRACTICE_BASELINE,
        "efficiency_metric": (
            "total risk weight of visited projects / inspector-days consumed; "
            "defined in optimization_engine.allocation_efficiency()"
        ),
        "headline_baseline": HEADLINE_BASELINE,
        "baseline_caveat": (
            "Baselines model manual practice; they are not an elicited description "
            "of PPDO's actual procedure. Report as 'against modelled manual "
            "practice' until confirmed with PPDO."
        ),
        "candidate_pool_size": int(len(priority_df)),
        "point_comparison": point,
        "scenario_sweep": sweep,
        "monte_carlo": mc,
    }

    headline = mc["improvement_over"].get(HEADLINE_BASELINE, {})
    practice = mc["improvement_over"].get(PRACTICE_BASELINE, {})
    if practice.get("n"):
        logger.warning(
            "OBJECTIVE 4, vs CURRENT PRACTICE (%s, no model): mean %.1f%%, median %.1f%%, "
            "90%% interval [%.1f%%, %.1f%%]. Met the 15%% target in %.1f%% of %d replications.",
            PRACTICE_BASELINE,
            100 * practice["mean_improvement"], 100 * practice["median_improvement"],
            100 * practice["p05"], 100 * practice["p95"],
            100 * practice["share_meeting_15pct_target"], practice["n"],
        )
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(results, indent=2), encoding="utf-8")
    logger.warning("Wrote %s", output)

    if headline.get("n"):
        logger.warning(
            "OBJECTIVE 4, vs MODEL-EQUIPPED COUNTERFACTUAL (%s): mean %.1f%%, "
            "median %.1f%%, 90%% interval [%.1f%%, %.1f%%]. Met the 15%% target in "
            "%.1f%% of %d replications.",
            HEADLINE_BASELINE,
            100 * headline["mean_improvement"],
            100 * headline["median_improvement"],
            100 * headline["p05"],
            100 * headline["p95"],
            100 * headline["share_meeting_15pct_target"],
            headline["n"],
        )
    return results


def parse_args(argv: Optional[list[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--candidates-csv", type=Path, default=None)
    parser.add_argument("--replications", type=int, default=200)
    parser.add_argument(
        "--prob-sigma", type=float, default=0.05,
        help="Std. dev. of Gaussian noise applied to each meta-learner probability.",
    )
    parser.add_argument(
        "--absence-rate", type=float, default=0.1,
        help="Per-inspector probability of being unavailable for the week.",
    )
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--output", type=Path, default=RESULTS_PATH)
    return parser.parse_args(argv)


def main(argv: Optional[list[str]] = None) -> int:
    args = parse_args(argv)
    run(
        args.candidates_csv, args.replications, args.prob_sigma,
        args.absence_rate, args.seed, args.output,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
