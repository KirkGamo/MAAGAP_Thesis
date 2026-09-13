"""
Objective 3 — logic consistency testing for the four-tier risk scoring engine.

The manuscript's third objective commits, in its own wording, to "applying
logic consistency testing and defined threshold boundaries to ensure the
reliability of risk classifications." This module is that test. It asserts
four separate properties:

  1. BOUNDARIES   — every Chapter 3 threshold maps on the correct side.
  2. MONOTONICITY — tier severity never decreases as probability rises.
  3. TOTALITY     — every probability in [0, 1] maps to exactly one known tier,
                    and anything outside that domain is rejected rather than
                    silently assigned one.
  4. SINGLE SOURCE— the trainer, the optimizer and the live scoring path all
                    resolve to the *same* function, so they cannot drift.

Property 4 is the one that would have caught the defect this module was written
alongside: three independent copies of the threshold ladder, agreeing by hand
rather than by construction.
"""

from __future__ import annotations

import math

import numpy as np
import pytest

from common.risk_tiers import (
    RISK_TIER_THRESHOLDS,
    TIER_ORDER,
    probabilities_to_risk_tiers,
    probability_to_risk_tier,
    tier_severity,
)


# ---------------------------------------------------------------------------
# 1. Boundaries — the exact values Chapter 3 names, on both sides of each cut.
# ---------------------------------------------------------------------------

@pytest.mark.parametrize(
    ("prob", "expected"),
    [
        (0.0, "Low"),
        (0.15, "Low"),
        (0.299, "Low"),
        (0.2999999, "Low"),
        (0.3, "Medium"),      # boundary is closed on the left
        (0.5, "Medium"),
        (0.699, "Medium"),
        (0.7, "High"),
        (0.8, "High"),
        (0.899, "High"),
        (0.9, "Critical"),
        (0.95, "Critical"),
        (1.0, "Critical"),    # closed at the top so p == 1.0 has a tier
    ],
)
def test_threshold_boundaries(prob: float, expected: str) -> None:
    assert probability_to_risk_tier(prob) == expected


def test_threshold_table_matches_the_function() -> None:
    """The published RISK_TIER_THRESHOLDS table must describe what the function
    actually does — a table that drifts from the code is worse than no table,
    because Chapter 3 quotes the table."""
    for tier, (lower, upper) in RISK_TIER_THRESHOLDS.items():
        assert probability_to_risk_tier(lower) == tier
        interior = lower + (upper - lower) / 2
        assert probability_to_risk_tier(interior) == tier


def test_threshold_table_is_contiguous_and_covers_the_unit_interval() -> None:
    """No gaps and no overlaps: each tier's upper bound is the next tier's
    lower bound, the ladder starts at 0.0 and ends at 1.0."""
    bounds = [RISK_TIER_THRESHOLDS[t] for t in TIER_ORDER]
    assert bounds[0][0] == 0.0
    assert bounds[-1][1] == 1.0
    for (_, upper), (next_lower, _) in zip(bounds, bounds[1:]):
        assert upper == next_lower


# ---------------------------------------------------------------------------
# 2. Monotonicity — a higher probability is never a less severe tier.
# ---------------------------------------------------------------------------

def test_severity_is_monotonic_across_the_unit_interval() -> None:
    probs = np.linspace(0.0, 1.0, 2001)
    severities = [tier_severity(probability_to_risk_tier(p)) for p in probs]
    assert all(a <= b for a, b in zip(severities, severities[1:]))


def test_every_tier_is_actually_reachable() -> None:
    """A ladder that can never emit one of its tiers is misconfigured — this
    catches a mis-ordered comparison that still happens to be monotonic."""
    reached = {probability_to_risk_tier(p) for p in np.linspace(0.0, 1.0, 2001)}
    assert reached == set(TIER_ORDER)


# ---------------------------------------------------------------------------
# 3. Totality — defined on [0, 1], rejecting everything else.
# ---------------------------------------------------------------------------

def test_every_probability_in_range_maps_to_a_known_tier() -> None:
    for p in np.linspace(0.0, 1.0, 5001):
        assert probability_to_risk_tier(p) in TIER_ORDER


def test_nan_is_rejected_rather_than_scored_critical() -> None:
    """REGRESSION TEST. Before the tiers were centralised, all three copies of
    this ladder were bare comparisons; every comparison against NaN is False,
    so NaN fell through to `return "Critical"`. That is the most severe tier
    and carries the optimizer's heaviest risk weight (2.5), so an unscoreable
    project would have outranked genuinely critical ones for a finite
    inspector visit."""
    with pytest.raises(ValueError, match="NaN"):
        probability_to_risk_tier(float("nan"))
    with pytest.raises(ValueError, match="NaN"):
        probability_to_risk_tier(np.nan)


@pytest.mark.parametrize("bad", [1.5, -0.2, 2.0, -1e-9, 1.0000001, math.inf, -math.inf])
def test_out_of_range_probabilities_are_rejected(bad: float) -> None:
    with pytest.raises(ValueError):
        probability_to_risk_tier(bad)


@pytest.mark.parametrize("bad", [None, object(), "high", "", [0.5]])
def test_non_numeric_inputs_are_rejected(bad: object) -> None:
    with pytest.raises((TypeError, ValueError)):
        probability_to_risk_tier(bad)  # type: ignore[arg-type]


@pytest.mark.parametrize(
    ("value", "expected"),
    [("0.5", "Medium"), ("0.95", "Critical"), (np.float32(0.1), "Low")],
)
def test_numeric_strings_and_numpy_scalars_are_accepted(value: object, expected: str) -> None:
    """Probabilities round-trip through CSV and JSON before reaching here, so a
    clean numeric string is a legitimate input. This is a documented contract,
    asserted so it stays deliberate rather than incidental."""
    assert probability_to_risk_tier(value) == expected  # type: ignore[arg-type]


def test_vectorized_helper_agrees_with_the_scalar_one() -> None:
    probs = np.linspace(0.0, 1.0, 501)
    vectorized = probabilities_to_risk_tiers(probs)
    scalar = np.array([probability_to_risk_tier(p) for p in probs])
    assert np.array_equal(vectorized, scalar)


def test_vectorized_helper_raises_on_a_single_nan() -> None:
    """One unscoreable row must not be quietly scored alongside good ones."""
    with pytest.raises(ValueError):
        probabilities_to_risk_tiers([0.1, 0.5, float("nan"), 0.95])


def test_tier_severity_rejects_unknown_tiers() -> None:
    with pytest.raises(ValueError):
        tier_severity("Severe")


# ---------------------------------------------------------------------------
# 4. Single source — the property that makes the other three transitive.
# ---------------------------------------------------------------------------

def test_all_consumers_share_one_tier_function() -> None:
    """The trainer, the optimizer and the live scoring path must resolve to the
    SAME object. Asserting equal behaviour on sampled inputs would pass even
    with three copies that happen to agree today; asserting identity is what
    actually forbids drift."""
    import inference.live_scoring as live_scoring
    import optimization_engine
    import train_meta_learner

    assert train_meta_learner.probability_to_risk_tier is probability_to_risk_tier
    assert optimization_engine.probability_to_risk_tier is probability_to_risk_tier
    assert live_scoring.probability_to_risk_tier is probability_to_risk_tier
