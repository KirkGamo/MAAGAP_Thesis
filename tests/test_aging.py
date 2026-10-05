"""
Tests for the aging term in the allocation objective (R2).

Two of these exist because of mistakes caught while designing the term, and they
are the ones that matter:

`test_normalisation_preserves_total_risk_weight` pins the property that stops an
alpha sweep from measuring the wrong thing. The objective subtracts travel,
budget and inspector-day penalties that do NOT scale with risk weight, so
multiplying every weight by (1 + alpha) makes risk worth more relative to cost
and the solver simply buys more visits. That effect is real, monotone and
convincing — and it is not aging. Normalisation holds total risk weight fixed so
only the redistribution between projects survives.

`test_aging_does_nothing_when_no_project_has_been_visited` pins the fact that a
single-week sweep over today's data measures nothing, because every candidate
has the same waiting time. That is not a bug to be worked around; it is what
aging means, and it is why the measurement is a multi-week simulation.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from common.aging import (
    DEFAULT_WINDOW_WEEKS,
    aging_multipliers,
    apply_aging,
    weeks_since_visit,
)

NOW = pd.Timestamp("2026-10-05", tz="UTC")


def _pool() -> pd.DataFrame:
    return pd.DataFrame(
        {
            "project_key": ["CRIT_A", "CRIT_B", "HIGH_A", "HIGH_B"],
            "risk_tier": ["Critical", "Critical", "High", "High"],
            "risk_weight": [2.5, 2.5, 1.0, 1.0],
        }
    )


# --- waiting time ------------------------------------------------------------


def test_a_never_visited_project_counts_as_having_waited_the_longest():
    """Treating 'never visited' as 'just visited' would give the projects most
    in need of attention the lowest priority — the inversion this prevents."""
    weeks = weeks_since_visit(
        pd.Series(["NEVER"]), {}, now=NOW, window_weeks=DEFAULT_WINDOW_WEEKS
    )
    assert weeks.iloc[0] == DEFAULT_WINDOW_WEEKS


def test_waiting_time_is_clamped_to_the_window():
    """Without a cap, a project unvisited for a year would dominate the
    objective regardless of risk, inverting the system's purpose."""
    ancient = {"OLD": NOW - pd.Timedelta(days=365)}
    weeks = weeks_since_visit(
        pd.Series(["OLD"]), ancient, now=NOW, window_weeks=12.0
    )
    assert weeks.iloc[0] == 12.0


def test_waiting_time_is_measured_in_weeks():
    visits = {"A": NOW - pd.Timedelta(days=14)}
    weeks = weeks_since_visit(pd.Series(["A"]), visits, now=NOW)
    assert weeks.iloc[0] == pytest.approx(2.0, abs=0.01)


# --- the control arm ---------------------------------------------------------


def test_alpha_zero_is_exactly_the_pre_r2_pipeline():
    """The ablation's control arm must be byte-identical to the old behaviour,
    or the sweep's baseline is not the system it claims to compare against."""
    pool = _pool()
    out = apply_aging(pool, {}, alpha=0.0, now=NOW)
    pd.testing.assert_frame_equal(out, pool)
    assert "aging_multiplier" not in out.columns


# --- the property that keeps the sweep honest --------------------------------


def test_normalisation_preserves_total_risk_weight():
    """THE important one.

    Total risk weight must be unchanged, so alpha cannot smuggle in a
    risk-versus-cost reweighting. Without this the sweep measures the solver
    buying more visits because risk got cheaper relative to travel and budget —
    a real effect, wrongly attributed to aging.
    """
    pool = _pool()
    visits = {
        "CRIT_A": NOW - pd.Timedelta(days=2),     # just visited
        "HIGH_A": NOW - pd.Timedelta(days=70),    # long overdue
    }
    before = pool["risk_weight"].sum()

    for alpha in (0.25, 0.5, 1.0, 2.0):
        out = apply_aging(pool, visits, alpha=alpha, now=NOW)
        assert out["risk_weight"].sum() == pytest.approx(before, rel=1e-9), (
            f"alpha={alpha} changed total risk weight, so it is also changing the "
            "risk-versus-cost balance rather than only redistributing priority"
        )


def test_aging_redistributes_priority_toward_the_long_unvisited():
    pool = _pool()
    visits = {
        "CRIT_A": NOW - pd.Timedelta(days=1),     # fresh
        "CRIT_B": NOW - pd.Timedelta(days=70),    # stale
    }
    out = apply_aging(pool, visits, alpha=1.0, now=NOW).set_index("project_key")

    assert out.loc["CRIT_B", "risk_weight"] > out.loc["CRIT_A", "risk_weight"], (
        "the longer-unvisited of two equally risky projects must gain weight"
    )
    # Tier still dominates at this alpha: a stale Critical outranks a stale High.
    assert out.loc["CRIT_B", "risk_weight"] > out.loc["HIGH_B", "risk_weight"]


def test_without_normalisation_total_weight_inflates():
    """Demonstrates the trap the normalisation closes, so the behaviour is
    pinned rather than merely described in a docstring."""
    pool = _pool()
    visits = {"CRIT_A": NOW - pd.Timedelta(days=1)}
    weeks = weeks_since_visit(pool["project_key"], visits, now=NOW)

    raw = aging_multipliers(weeks, alpha=1.0, normalize=False)
    inflated = float((pool["risk_weight"] * raw).sum())
    assert inflated > pool["risk_weight"].sum() * 1.3, (
        "un-normalised aging should visibly inflate total risk weight — that is "
        "precisely why normalisation is on by default"
    )


# --- the limit of a single-week measurement ----------------------------------


def test_aging_does_nothing_when_no_project_has_been_visited():
    """Pins why a single-week alpha sweep over today's data is uninformative.

    85 of 100 High/Critical projects have never been visited. They all share the
    same waiting time, so normalisation returns 1.0 for every one of them and
    alpha has no effect. The flat line is correct, not broken — aging can only
    redistribute priority once histories differ.
    """
    pool = _pool()
    out = apply_aging(pool, {}, alpha=2.0, now=NOW)

    assert out["aging_multiplier"].nunique() == 1
    assert out["aging_multiplier"].iloc[0] == pytest.approx(1.0, rel=1e-9)
    pd.testing.assert_series_equal(
        out["risk_weight"], pool["risk_weight"], check_names=False
    )


def test_a_single_visit_is_enough_to_make_alpha_bite():
    """The converse: the moment one project's history differs, aging engages."""
    pool = _pool()
    out = apply_aging(
        pool, {"CRIT_A": NOW - pd.Timedelta(days=1)}, alpha=1.0, now=NOW
    )
    assert out["aging_multiplier"].nunique() > 1
    assert not np.allclose(out["risk_weight"], pool["risk_weight"])


def test_an_empty_pool_is_handled():
    empty = _pool().iloc[0:0]
    out = apply_aging(empty, {}, alpha=1.0, now=NOW)
    assert out.empty
