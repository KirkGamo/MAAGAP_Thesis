"""
MAAGAP — Risk tier boundaries (Objective 3)
================================================================================
THE single definition of the four Chapter 3 risk tiers and the probability
boundaries that separate them. Every consumer imports from here.

WHY THIS EXISTS
------------------------------------------------------------------------------
`probability_to_risk_tier()` was previously defined three times, independently,
in three modules that must agree for the system to be coherent:

    models/train_meta_learner.py   — assigns the tier stored at training time
    optimization_engine.py         — assigns the tier the PuLP solver prioritizes
    inference/live_scoring.py      — assigns the tier written on a field report

The three copies did agree when this module was introduced, but nothing
enforced that. Objective 3 commits in writing to "logic consistency testing";
three hand-maintained copies of a threshold ladder is the precise shape of
defect that commitment is meant to exclude. Drift between them would not raise
an error anywhere — it would silently produce a project whose stored tier
disagrees with the tier the optimizer schedules against, which is the same
class of failure as the reporting-loop bug where a field-reported completion
and its re-score disagreed and PostgREST returned no error.

NaN AND OUT-OF-RANGE INPUTS — A BEHAVIOUR CHANGE, DELIBERATE
------------------------------------------------------------------------------
All three original copies were written as a bare comparison ladder:

    if prob < 0.3: return "Low"
    ...
    return "Critical"          # <- everything that falls through

Because every comparison against NaN is False, `float("nan")` fell through the
whole ladder and was returned as **"Critical"** — the most severe tier, and the
one carrying the optimizer's heaviest risk weight (2.5). An unscoreable project
would therefore not merely be mislabelled; it would outrank genuinely critical
projects for a finite field-inspector visit. A probability of 1.5 mapped to
Critical by the same fall-through, and -0.2 mapped to Low.

This module rejects any input that is not a real number in [0, 1] instead of
minting a tier for it. The pipeline should fail loudly on an unscoreable
probability rather than quietly spend an inspector day on it. Callers that can
legitimately hold "no score yet" must represent that as None/NULL — the
`projects` table already models an unscored row that way — and must not route
it through this function.
"""

from __future__ import annotations

import math
from typing import Iterable

import numpy as np

# ---------------------------------------------------------------------------
# Chapter 3 boundaries. Half-open intervals [lower, upper), except Critical,
# which is closed at 1.0 so that a probability of exactly 1.0 has a tier.
# ---------------------------------------------------------------------------

RISK_TIER_THRESHOLDS: dict[str, tuple[float, float]] = {
    "Low": (0.0, 0.3),
    "Medium": (0.3, 0.7),
    "High": (0.7, 0.9),
    "Critical": (0.9, 1.0),
}

# Ascending severity. Used for the monotonicity property test and by any caller
# that needs to compare two tiers rather than merely name one.
TIER_ORDER: tuple[str, ...] = ("Low", "Medium", "High", "Critical")

TIER_SEVERITY: dict[str, int] = {tier: i for i, tier in enumerate(TIER_ORDER)}


def probability_to_risk_tier(prob: float) -> str:
    """
    Map a single P(RedFlag=1) probability to its Chapter 3 risk tier.

    Boundaries: Low [0, 0.3), Medium [0.3, 0.7), High [0.7, 0.9),
    Critical [0.9, 1.0].

    Accepts anything that converts cleanly to a real number — a Python float,
    a numpy scalar, or a numeric string such as "0.5", since probabilities
    round-trip through CSV and JSON on the way here. What it will not do is
    invent a tier for a value that is not a probability.

    Raises
    ------
    ValueError
        If `prob` is NaN, infinite, or outside [0, 1]. See the module docstring
        for why these are rejected rather than defaulted — the previous
        fall-through behaviour silently returned "Critical" for NaN.
    TypeError
        If `prob` cannot be interpreted as a real number at all.
    """
    try:
        value = float(prob)
    except (TypeError, ValueError) as exc:
        raise TypeError(
            f"risk tier requires a real number, got {prob!r} ({type(prob).__name__})"
        ) from exc

    if math.isnan(value):
        raise ValueError(
            "risk tier is undefined for NaN — an unscoreable project must be "
            "represented as an absent score (None/NULL), not routed through "
            "probability_to_risk_tier()"
        )
    if math.isinf(value) or not (0.0 <= value <= 1.0):
        raise ValueError(
            f"risk tier requires a probability in [0, 1], got {value!r}"
        )

    if value < 0.3:
        return "Low"
    if value < 0.7:
        return "Medium"
    if value < 0.9:
        return "High"
    return "Critical"


def probabilities_to_risk_tiers(probs: Iterable[float]) -> np.ndarray:
    """Vectorized `probability_to_risk_tier`. Same validation, same errors —
    an array carrying a single NaN raises rather than scoring the rest."""
    return np.array([probability_to_risk_tier(p) for p in probs])


def tier_severity(tier: str) -> int:
    """Ascending rank of a tier (Low=0 … Critical=3), for ordering comparisons."""
    try:
        return TIER_SEVERITY[tier]
    except KeyError as exc:
        raise ValueError(
            f"unknown risk tier {tier!r}; expected one of {TIER_ORDER}"
        ) from exc
