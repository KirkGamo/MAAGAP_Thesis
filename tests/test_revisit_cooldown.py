"""
Tests for the scheduler's revisit cooldown (R1).

WHY THESE EXIST, AND WHY THEY MATTER MORE THAN USUAL
--------------------------------------------------------------------------------
The cooldown fixes a defect found by running the deployed system, not by reading
the code: every one of the 60 scheduled visits was Critical, no High-tier project
was ever scheduled, and successive solves returned an identical schedule. The
cause was that select_priority_projects() consulted no record of prior visits, so
the solve was a pure function of the current risk scores — nothing in its inputs
changed between weeks, so nothing in its output did either.

The fix cannot be demonstrated against live data. The database holds two
monitoring reports, because the system is not yet in production use, so a test
against reality would exclude two projects and prove nothing. These tests
construct the population that exhibits the defect — more Critical projects than
the week has capacity for, plus some High ones — and show that the cooldown is
what makes the lower tier reachable.

The headline test is `test_cooldown_lets_the_high_tier_become_reachable`. The
rest guard the edges around it.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pandas as pd
import pytest

from common.visit_history import (
    DEFAULT_COOLDOWN_DAYS,
    cooldown_days,
    recently_visited_keys,
)
from optimization_engine import select_priority_projects


@pytest.fixture(autouse=True)
def _no_dotenv(monkeypatch):
    """Neutralise ml-service/.env for every test in this module.

    recently_visited_keys() calls load_env_file() so that the CLI workflow finds
    credentials the way the API already does. That is correct in production and
    wrong in a test: without this fixture these tests read whichever .env the
    developer happens to have, so "no credentials configured" would quietly
    become "connect to the real project" — and the suite would hit the network,
    pass or fail depending on a file that is not in version control, and differ
    between a laptop and CI.
    """
    monkeypatch.setattr("common.visit_history.load_env_file", lambda *a, **k: 0)


def _population(n_critical: int, n_high: int) -> pd.DataFrame:
    """A scored population shaped like the deployed one: Critical projects in
    excess of weekly capacity, with a handful of High projects behind them."""
    rows = []
    for i in range(n_critical):
        rows.append(
            {
                "project_key": f"CRIT_{i:03d}",
                "risk_tier": "Critical",
                # Descending so ordering is deterministic and Critical always
                # outranks High on meta_prob as well as on tier weight.
                "meta_prob": 0.99 - i * 0.0001,
                "cluster": "Central Metro",
                "status_excludes_scheduling": False,
            }
        )
    for i in range(n_high):
        rows.append(
            {
                "project_key": f"HIGH_{i:03d}",
                "risk_tier": "High",
                "meta_prob": 0.75 - i * 0.0001,
                "cluster": "Central Metro",
                "status_excludes_scheduling": False,
            }
        )
    return pd.DataFrame(rows)


# --- the defect, and the fix -------------------------------------------------


def test_without_a_cooldown_the_candidate_pool_is_identical_every_week():
    """The defect itself. Two successive selections over unchanged scores return
    the same projects, which is why the deployed schedule never varied."""
    population = _population(n_critical=79, n_high=21)

    week_one = select_priority_projects(population, max_projects=60)
    week_two = select_priority_projects(population, max_projects=60)

    assert list(week_one["project_key"]) == list(week_two["project_key"])
    assert set(week_one["risk_tier"]) == {"Critical"}, (
        "with 79 Critical projects and room for 60, the pool should be entirely "
        "Critical — this is the starvation the cooldown exists to break"
    )


def test_cooldown_lets_the_high_tier_become_reachable():
    """The point of R1.

    Week one schedules 60 Critical projects. Week two must exclude them, which
    leaves 19 Critical — fewer than capacity — so High projects enter the pool
    for the first time.
    """
    population = _population(n_critical=79, n_high=21)

    week_one = select_priority_projects(population, max_projects=60)
    visited = set(week_one["project_key"])
    assert len(visited) == 60

    week_two = select_priority_projects(
        population, max_projects=60, recently_visited=visited
    )

    assert not (set(week_two["project_key"]) & visited), (
        "a project visited last week must not reappear while it is on cooldown"
    )
    tiers = set(week_two["risk_tier"])
    assert "High" in tiers, (
        "the cooldown must make the High tier reachable — this is the defect it fixes"
    )
    # 79 - 60 = 19 Critical remain, and the rest of the pool is High.
    assert (week_two["risk_tier"] == "Critical").sum() == 19
    assert (week_two["risk_tier"] == "High").sum() == 21


def test_a_project_not_on_cooldown_is_still_eligible():
    population = _population(n_critical=5, n_high=5)
    pool = select_priority_projects(
        population, max_projects=60, recently_visited={"CRIT_000"}
    )
    keys = set(pool["project_key"])
    assert "CRIT_000" not in keys
    assert "CRIT_001" in keys
    assert "HIGH_000" in keys


def test_cooldown_also_constrains_the_relative_risk_fallback():
    """The fallback pool must not hand back a project the cooldown removed.

    When fewer than MIN_PRIORITY_PROJECTS_FOR_SCHEDULING projects clear the tier
    thresholds, selection falls back to the top-N by relative meta_prob. That
    path is the obvious place for an exclusion to be silently bypassed, which is
    why the filter is applied to `schedulable` before the branch rather than to
    the tier-filtered frame after it.
    """
    population = _population(n_critical=2, n_high=1)   # below the fallback floor
    visited = {"CRIT_000", "CRIT_001"}

    pool = select_priority_projects(
        population, max_projects=60, recently_visited=visited
    )

    assert not (set(pool["project_key"]) & visited), (
        "the relative-risk fallback reintroduced a project on cooldown"
    )


def test_an_empty_cooldown_set_changes_nothing():
    population = _population(n_critical=5, n_high=5)
    baseline = select_priority_projects(population, max_projects=60)
    for empty in (None, set()):
        pool = select_priority_projects(
            population, max_projects=60, recently_visited=empty
        )
        assert list(pool["project_key"]) == list(baseline["project_key"])


# --- configuration -----------------------------------------------------------


def test_cooldown_days_defaults_when_unset(monkeypatch):
    """The default is now 0 — the cooldown is off unless asked for, because the
    aging term replaced it as the anti-starvation mechanism."""
    monkeypatch.delenv("ML_SERVICE_REVISIT_COOLDOWN_DAYS", raising=False)
    assert cooldown_days() == DEFAULT_COOLDOWN_DAYS
    assert DEFAULT_COOLDOWN_DAYS == 0


@pytest.mark.parametrize("raw,expected", [("7", 7), ("0", 0), ("90", 90)])
def test_cooldown_days_reads_the_environment(monkeypatch, raw, expected):
    monkeypatch.setenv("ML_SERVICE_REVISIT_COOLDOWN_DAYS", raw)
    assert cooldown_days() == expected


@pytest.mark.parametrize("raw", ["", "   ", "four", "-3", "3.5"])
def test_a_bad_cooldown_value_falls_back_to_the_default(monkeypatch, raw):
    """An unreadable value must not disable the cooldown. Silently reading a
    typo as 'no cooldown' is the shape of failure this codebase keeps meeting."""
    monkeypatch.setenv("ML_SERVICE_REVISIT_COOLDOWN_DAYS", raw)
    assert cooldown_days() == DEFAULT_COOLDOWN_DAYS


# --- degrading loudly --------------------------------------------------------


def test_without_supabase_the_cooldown_is_skipped_but_recorded(monkeypatch):
    """A solve must survive an unreachable database — but the resulting schedule
    must say it was built without a cooldown, so it cannot be mistaken for one
    that had the history available."""
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    monkeypatch.delenv("SUPABASE_SERVICE_ROLE_KEY", raising=False)

    # An explicit window: the default is now 0 (disabled, since aging replaced
    # the cooldown), which short-circuits before the database is consulted. This
    # test is about what happens when a cooldown IS requested and the history
    # cannot be read.
    keys, provenance = recently_visited_keys(days=28)

    assert keys == set()
    assert provenance["applied"] is False
    assert provenance["reason"], "a skipped cooldown must carry a stated reason"
    assert "SUPABASE" in provenance["reason"].upper()


def test_a_disabled_cooldown_is_distinguishable_from_a_failed_one(monkeypatch):
    """Zero is a legitimate setting; 'could not read the database' is not the
    same thing, and the summary must tell them apart."""
    monkeypatch.setenv("ML_SERVICE_REVISIT_COOLDOWN_DAYS", "0")
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "not-used-the-window-is-zero")

    keys, provenance = recently_visited_keys()

    assert keys == set()
    assert provenance["applied"] is False
    assert provenance["cooldown_days"] == 0
    assert "disabled" in provenance["reason"].lower()


def test_provenance_reports_the_window_it_used(monkeypatch):
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    monkeypatch.delenv("SUPABASE_SERVICE_ROLE_KEY", raising=False)
    _, provenance = recently_visited_keys(days=14)
    assert provenance["cooldown_days"] == 14
    assert provenance["source"] == "monitoring_reports.visited_at"


def test_a_read_failure_does_not_raise_into_the_solve(monkeypatch):
    """A solve must not die because a history read failed."""
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "key")

    import common.visit_history as vh

    def explode(*_args, **_kwargs):
        raise ConnectionError("database unreachable")

    monkeypatch.setattr(vh, "create_client", explode, raising=False)
    monkeypatch.setitem(
        __import__("sys").modules, "supabase",
        type("m", (), {"create_client": staticmethod(explode)}),
    )

    keys, provenance = recently_visited_keys(days=28)
    assert keys == set()
    assert provenance["applied"] is False
    assert "unreachable" in provenance["reason"] or "ConnectionError" in provenance["reason"]


def test_the_cutoff_is_computed_from_the_injected_clock(monkeypatch):
    """`now` is injectable so the window is testable against a fixed clock
    rather than against whatever today happens to be."""
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    monkeypatch.delenv("SUPABASE_SERVICE_ROLE_KEY", raising=False)
    fixed = datetime(2026, 6, 15, tzinfo=timezone.utc)
    _, provenance = recently_visited_keys(days=30, now=fixed)
    # No credentials, so no cutoff is recorded — but the window must survive.
    assert provenance["cooldown_days"] == 30
    assert (fixed - timedelta(days=30)).year == 2026
