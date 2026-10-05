"""
Constraint-satisfaction tests for the budget and equipment constraints added
to optimization_engine.py's PuLP model (Objective 4), plus the allocation
efficiency metric and the manual-practice baselines they are measured against.

These complement tests/test_optimization_engine.py, which covers the capacity
and geographic constraints that were already implemented. Same approach: call
the solver directly with a small hand-built candidate pool, and demonstrate
mathematically that the returned schedule respects what the model claims,
rather than asserting against a recorded fixture.

Chapter 3 formulates the problem "under constraints such as budget, manpower,
and equipment". Manpower and geography were implemented and tested; budget and
equipment were printed in the manuscript and absent from the code. These tests
exist so that cannot silently happen again.
"""

from __future__ import annotations

import pandas as pd
import pytest

from allocation_evaluation import BASELINES, greedy_allocate, order_risk_ranked
from optimization_engine import (
    CLUSTER_MOBILIZATION_COST_PHP,
    VISIT_COST_PHP,
    allocation_efficiency,
    build_and_solve_schedule,
)

INSPECTORS = ["Inspector_1", "Inspector_2", "Inspector_3", "Inspector_4"]
DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"]


def _make_priority_df(n_projects: int, clusters: list[str], tier: str = "Critical") -> pd.DataFrame:
    weight = 2.5 if tier == "Critical" else 1.0
    return pd.DataFrame([
        {
            "project_key": f"PRJ_{i}",
            "project_name": f"Test Project {i}",
            "municipality": f"Municipality_{i % len(clusters)}",
            "cluster": clusters[i % len(clusters)],
            "risk_tier": tier,
            "meta_prob": 0.95 if tier == "Critical" else 0.75,
            "risk_weight": weight,
        }
        for i in range(n_projects)
    ])


# ---------------------------------------------------------------------------
# Equipment (vehicle pool)
# ---------------------------------------------------------------------------

def test_no_day_deploys_more_inspectors_than_vehicles():
    """The binding case: more inspectors than vehicles, and far more work than
    either could absorb. No single day may put more inspectors in the field
    than there are vehicles to carry them."""
    priority_df = _make_priority_df(60, ["North Coastal", "Central Metro", "Western Upland"])
    schedule_df, summary = build_and_solve_schedule(
        priority_df, inspectors=INSPECTORS, days=DAYS, vehicle_count=2,
        weekly_budget_php=10_000_000.0,
    )

    per_day = schedule_df.groupby("day")["inspector"].nunique()
    assert (per_day <= 2).all(), (
        f"Day(s) deploying more inspectors than the 2 available vehicles:\n"
        f"{per_day[per_day > 2]}"
    )
    assert summary["max_inspectors_deployed_in_a_day"] <= 2


def test_a_larger_vehicle_pool_never_schedules_less_work():
    """Relaxing the vehicle constraint cannot reduce achievable coverage — a
    monotonicity property. If it does, the constraint is mis-signed."""
    priority_df = _make_priority_df(60, ["North Coastal", "Central Metro", "Western Upland"])
    tight, _ = build_and_solve_schedule(
        priority_df, inspectors=INSPECTORS, days=DAYS, vehicle_count=1,
        weekly_budget_php=10_000_000.0,
    )
    loose, _ = build_and_solve_schedule(
        priority_df, inspectors=INSPECTORS, days=DAYS, vehicle_count=4,
        weekly_budget_php=10_000_000.0,
    )
    assert len(loose) >= len(tight)


# ---------------------------------------------------------------------------
# Budget
# ---------------------------------------------------------------------------

def test_total_cost_never_exceeds_the_weekly_budget():
    priority_df = _make_priority_df(60, ["North Coastal", "Central Metro"])
    budget = 8_000.0
    schedule_df, summary = build_and_solve_schedule(
        priority_df, inspectors=INSPECTORS, days=DAYS,
        weekly_budget_php=budget, vehicle_count=4,
    )
    assert summary["total_cost_php"] <= budget + 1e-6, (
        f"Solve cost PHP {summary['total_cost_php']:.2f} against a PHP {budget:.2f} budget."
    )


def test_a_tight_budget_actually_binds_and_reduces_visits():
    """A constraint that never binds is not a constraint. With a budget barely
    covering a handful of visits, the solver must schedule materially fewer
    projects than it does with an unconstrained budget."""
    priority_df = _make_priority_df(60, ["North Coastal", "Central Metro"])
    generous, _ = build_and_solve_schedule(
        priority_df, inspectors=INSPECTORS, days=DAYS,
        weekly_budget_php=10_000_000.0, vehicle_count=4,
    )
    tight, tight_summary = build_and_solve_schedule(
        priority_df, inspectors=INSPECTORS, days=DAYS,
        weekly_budget_php=VISIT_COST_PHP * 4 + CLUSTER_MOBILIZATION_COST_PHP,
        vehicle_count=4,
    )
    assert len(tight) < len(generous)
    assert tight_summary["budget_utilization"] <= 1.0


def test_the_solver_prefers_critical_projects_when_the_budget_forces_a_choice():
    """Budget scarcity must be resolved by risk, not arbitrarily: with room for
    only a few visits, the Critical projects should be the ones taken."""
    critical = _make_priority_df(10, ["North Coastal"], tier="Critical")
    high = _make_priority_df(10, ["North Coastal"], tier="High")
    high["project_key"] = [f"HIGH_{i}" for i in range(len(high))]
    pool = pd.concat([high, critical], ignore_index=True)  # High listed FIRST

    schedule_df, _ = build_and_solve_schedule(
        pool, inspectors=INSPECTORS, days=DAYS,
        weekly_budget_php=VISIT_COST_PHP * 3 + CLUSTER_MOBILIZATION_COST_PHP,
        vehicle_count=4,
    )
    assert not schedule_df.empty
    assert (schedule_df["risk_tier"] == "Critical").all(), (
        "Under a binding budget the solver took non-Critical work while Critical "
        f"projects were available:\n{schedule_df[['project_key', 'risk_tier']]}"
    )


# ---------------------------------------------------------------------------
# Efficiency metric
# ---------------------------------------------------------------------------

def test_allocation_efficiency_is_risk_weight_per_inspector_day():
    """Hand-computed: 3 Critical (2.5) + 1 High (1.0) = 8.5 risk weight over
    2 distinct inspector-days = 4.25."""
    schedule = pd.DataFrame([
        {"inspector": "Inspector_1", "day": "Mon", "risk_tier": "Critical"},
        {"inspector": "Inspector_1", "day": "Mon", "risk_tier": "Critical"},
        {"inspector": "Inspector_1", "day": "Mon", "risk_tier": "Critical"},
        {"inspector": "Inspector_2", "day": "Tue", "risk_tier": "High"},
    ])
    assert allocation_efficiency(schedule) == pytest.approx(4.25)


def test_allocation_efficiency_is_none_for_an_empty_schedule():
    assert allocation_efficiency(pd.DataFrame()) is None


# ---------------------------------------------------------------------------
# Baselines — the comparison must be fair to be worth anything
# ---------------------------------------------------------------------------

def test_baselines_respect_the_same_feasibility_constraints_as_the_solver():
    """If a baseline could violate capacity, geography or the vehicle pool, it
    would produce schedules that are not executable, and any improvement
    measured against it would be manufactured rather than real."""
    priority_df = _make_priority_df(60, ["North Coastal", "Central Metro", "Western Upland"])
    for name, order_fn in BASELINES.items():
        import numpy as np

        rng = np.random.default_rng(7)
        base = greedy_allocate(
            priority_df, order_fn(priority_df, rng), inspectors=INSPECTORS, days=DAYS,
            daily_capacity=3, weekly_capacity=12, vehicle_count=2,
            weekly_budget_php=10_000_000.0,
        )
        assert not base.empty, f"{name} baseline scheduled nothing"

        per_day = base.groupby(["inspector", "day"]).size()
        assert (per_day <= 3).all(), f"{name} exceeded daily capacity"

        per_week = base.groupby("inspector").size()
        assert (per_week <= 12).all(), f"{name} exceeded weekly capacity"

        clusters_per_day = base.groupby(["inspector", "day"])["cluster"].nunique()
        assert (clusters_per_day <= 1).all(), f"{name} split an inspector-day across clusters"

        vehicles = base.groupby("day")["inspector"].nunique()
        assert (vehicles <= 2).all(), f"{name} exceeded the vehicle pool"

        assert base["project_key"].is_unique, f"{name} visited a project twice"


def test_baselines_respect_the_budget():
    import numpy as np

    priority_df = _make_priority_df(60, ["North Coastal", "Central Metro"])
    budget = VISIT_COST_PHP * 5 + CLUSTER_MOBILIZATION_COST_PHP * 2
    base = greedy_allocate(
        priority_df, order_risk_ranked(priority_df, np.random.default_rng(1)),
        inspectors=INSPECTORS, days=DAYS, vehicle_count=4, weekly_budget_php=budget,
    )
    cluster_weeks = base.groupby(["inspector", "cluster"]).ngroups if not base.empty else 0
    cost = VISIT_COST_PHP * len(base) + CLUSTER_MOBILIZATION_COST_PHP * cluster_weeks
    assert cost <= budget + 1e-6


# ---------------------------------------------------------------------------
# allocation_efficiency on the relative-risk fallback pool.
#
# Found while building R2's simulation: weeks 3 onward reported an efficiency of
# exactly 0.0 with 50+ visits scheduled. The cause was that
# select_priority_projects() had fallen back to the relative-risk pool, which
# tags every row "Relative-Risk (fallback)" -- a label deliberately not in
# RISK_WEIGHTS, because those rows are NOT real Chapter 3 tiers. Mapping yielded
# NaN for every row and .fillna(0.0) turned that into a reported 0.0.
#
# Objective 4's headline metric was therefore printing the most alarming value
# in its range, as a number, whenever the fallback was active.
# ---------------------------------------------------------------------------


def _sched(tiers):
    return pd.DataFrame(
        {
            "risk_tier": tiers,
            "inspector": [f"I{i % 2 + 1}" for i in range(len(tiers))],
            "day": ["Mon", "Tue", "Wed", "Thu", "Fri"][: len(tiers)] * 1,
        }
    )


def test_efficiency_is_undefined_not_zero_for_a_fallback_only_schedule():
    schedule = _sched(["Relative-Risk (fallback)"] * 4)
    assert allocation_efficiency(schedule) is None, (
        "a schedule of fallback rows has no computable 'risk retired per "
        "inspector-day'; reporting 0.0 makes it look worthless instead of "
        "unmeasured"
    )


def test_efficiency_still_computes_when_only_some_rows_are_unweighted():
    """A mixed schedule is measurable: the weighted rows count, the fallback
    rows contribute nothing, and the caller is warned rather than misled."""
    schedule = _sched(["Critical", "Relative-Risk (fallback)"])
    # One Critical (2.5) over two inspector-days.
    assert allocation_efficiency(schedule) == pytest.approx(1.25)


def test_efficiency_is_unchanged_for_real_tiers():
    assert allocation_efficiency(_sched(["Critical"] * 4)) == pytest.approx(2.5)
    assert allocation_efficiency(_sched(["High"] * 4)) == pytest.approx(1.0)
