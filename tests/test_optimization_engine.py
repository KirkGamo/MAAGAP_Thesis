"""
Phase 14: constraint-satisfaction tests for
ml-service/optimization_engine.py's PuLP model.

These call build_and_solve_schedule() directly with a small, hand-built
candidate pool -- no trained model artifacts, no data/ready files, and no
Supabase/network access are needed, since that function takes a plain
DataFrame (project_key, project_name, municipality, cluster, risk_tier,
meta_prob, risk_weight) and returns a schedule + summary. This isolates the
LP formulation itself from the scoring pipeline that normally produces its
input.

The goal is to mathematically demonstrate -- not just assert against a
fixture -- that the solver's output actually respects the constraints the
module docstring claims: per-day capacity, per-week capacity, each project
visited at most once, and single-cluster-per-day geographic coherence.
"""

import pandas as pd
import pytest

from optimization_engine import build_and_solve_schedule


def _make_priority_df(n_projects: int, clusters: list[str]) -> pd.DataFrame:
    """N synthetic candidate projects, spread across the given clusters in
    round-robin order, all tagged Critical/risk_weight=2.5 so the objective
    has no reason to leave capacity on the table (a solver that
    under-schedules against a maximizing objective would be a real bug, not
    just a stylistic choice)."""
    rows = []
    for i in range(n_projects):
        rows.append({
            "project_key": f"PRJ_{i}",
            "project_name": f"Test Project {i}",
            "municipality": f"Municipality_{i % len(clusters)}",
            "cluster": clusters[i % len(clusters)],
            "risk_tier": "Critical",
            "meta_prob": 0.95,
            "risk_weight": 2.5,
        })
    return pd.DataFrame(rows)


def test_no_inspector_exceeds_daily_capacity():
    """Even with far more candidate projects than any inspector could ever
    cover, no single inspector-day should be assigned more than
    daily_capacity visits."""
    priority_df = _make_priority_df(30, ["North Coastal", "Central Metro"])
    schedule_df, _ = build_and_solve_schedule(
        priority_df,
        inspectors=["Inspector_1", "Inspector_2", "Inspector_3"],
        days=["Mon", "Tue", "Wed", "Thu", "Fri"],
        daily_capacity=3,
        weekly_capacity=12,
    )

    per_inspector_day = schedule_df.groupby(["inspector", "day"]).size()
    assert (per_inspector_day <= 3).all(), (
        f"Found inspector-day(s) exceeding daily_capacity=3:\n{per_inspector_day[per_inspector_day > 3]}"
    )


def test_no_inspector_exceeds_weekly_capacity():
    """Weekly capacity must hold even when daily capacity alone would allow
    more (3/day * 5 days = 15 > weekly_capacity=12 in this test)."""
    priority_df = _make_priority_df(40, ["North Coastal", "Central Metro", "Western Upland"])
    schedule_df, _ = build_and_solve_schedule(
        priority_df,
        inspectors=["Inspector_1", "Inspector_2"],
        days=["Mon", "Tue", "Wed", "Thu", "Fri"],
        daily_capacity=3,
        weekly_capacity=12,
    )

    per_inspector_week = schedule_df.groupby("inspector").size()
    assert (per_inspector_week <= 12).all(), (
        f"Found inspector(s) exceeding weekly_capacity=12:\n{per_inspector_week[per_inspector_week > 12]}"
    )


def test_each_project_scheduled_at_most_once():
    """A project must never appear twice in the solved schedule -- across
    different inspectors, different days, or both."""
    priority_df = _make_priority_df(25, ["North Coastal", "Central Metro"])
    schedule_df, _ = build_and_solve_schedule(
        priority_df,
        inspectors=["Inspector_1", "Inspector_2", "Inspector_3"],
        days=["Mon", "Tue", "Wed", "Thu", "Fri"],
        daily_capacity=3,
        weekly_capacity=12,
    )

    counts = schedule_df["project_key"].value_counts()
    assert (counts <= 1).all(), f"Project(s) scheduled more than once:\n{counts[counts > 1]}"


def test_each_inspector_visits_only_one_cluster_per_day():
    """The module's stated geographic-coherence guarantee: an inspector's
    assignments on any single day must all belong to the SAME cluster --
    the y[i,d,c] <= 1 constraint structurally forbids cross-cluster hopping
    within a day. This is the constraint most likely to silently regress if
    someone edits the LP formulation without realizing what it's protecting."""
    priority_df = _make_priority_df(30, ["North Coastal", "Central Metro", "Western Upland"])
    schedule_df, _ = build_and_solve_schedule(
        priority_df,
        inspectors=["Inspector_1", "Inspector_2"],
        days=["Mon", "Tue", "Wed", "Thu", "Fri"],
        daily_capacity=3,
        weekly_capacity=12,
    )

    clusters_per_inspector_day = schedule_df.groupby(["inspector", "day"])["cluster"].nunique()
    assert (clusters_per_inspector_day <= 1).all(), (
        f"Found inspector-day(s) spanning more than one cluster:\n"
        f"{clusters_per_inspector_day[clusters_per_inspector_day > 1]}"
    )


def test_summary_statistics_match_the_schedule_dataframe():
    """build_and_solve_schedule()'s summary dict is a derived, independently
    computed view of the same schedule -- if it drifts out of sync with the
    actual DataFrame, downstream consumers (the FastAPI /api/v1/latest-schedule
    endpoint, the frontend's deploy action) would report incorrect coverage
    numbers to a Manager without any indication anything was wrong."""
    priority_df = _make_priority_df(20, ["North Coastal", "Central Metro"])
    schedule_df, summary = build_and_solve_schedule(
        priority_df,
        inspectors=["Inspector_1", "Inspector_2"],
        days=["Mon", "Tue", "Wed", "Thu", "Fri"],
        daily_capacity=3,
        weekly_capacity=12,
    )

    assert summary["candidate_projects"] == len(priority_df)
    assert summary["projects_scheduled"] == schedule_df["project_key"].nunique()
    assert summary["critical_projects_scheduled"] == int((schedule_df["risk_tier"] == "Critical").sum())
    assert summary["clusters_touched"] == schedule_df["cluster"].nunique()
    assert summary["solver_status"] in ("Optimal", "Not Solved", "Infeasible", "Unbounded", "Undefined")


def test_raises_on_empty_candidate_pool():
    """An empty candidate pool is a caller error (nothing to schedule), not
    a silently-empty-but-successful solve -- build_and_solve_schedule()
    should say so explicitly rather than returning an empty schedule that
    could be mistaken for 'the solver ran and found nothing worth doing'."""
    empty_df = pd.DataFrame(columns=["project_key", "project_name", "municipality", "cluster", "risk_tier", "meta_prob", "risk_weight"])
    with pytest.raises(ValueError):
        build_and_solve_schedule(empty_df, inspectors=["Inspector_1"], days=["Mon"])
