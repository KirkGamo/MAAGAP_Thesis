"""
MAAGAP — aging the allocation objective, so waiting accumulates priority (R2)
================================================================================
A revisit cooldown (R1) is binary: a project is either eligible or it is not.
Aging is the graded version — the longer a project has gone unvisited, the more
the objective values visiting it — and it is the standard treatment for
starvation in scheduling.

    multiplier(i) = 1 + alpha * min(weeks_since_visit(i), W) / W
    weight(i)     = RISK_WEIGHTS[tier(i)] * multiplier(i)

alpha = 0 reproduces the current behaviour exactly, which makes today's model a
special case of this one and gives Chapter 4 a clean ablation.

The multiplier is computed per project BEFORE the solve, so every objective
coefficient stays a constant and the problem remains the same integer linear
program CBC already solves. No new variable classes, no change to tractability.

WHY THE NORMALISATION IS NOT OPTIONAL
------------------------------------------------------------------------------
The objective is not risk alone:

    max  sum(risk_weight[p] * x)  -  travel*sum(z)  -  cost_weight*total_cost
                                  -  inspector_day_penalty*inspector_days

None of the three penalty terms scales with risk_weight. So multiplying every
risk weight by (1 + alpha) does not merely reorder projects — it makes risk
worth more RELATIVE TO travel, budget and inspector time, and the solver responds
by buying more visits. An un-normalised alpha sweep would therefore produce a
real, monotone, entirely convincing effect that is not aging at all: it is the
risk-versus-cost trade-off being reweighted under another name.

`normalize=True` rescales the multipliers so that the pool's TOTAL risk weight
is unchanged:

    m <- m * ( sum(w) / sum(w * m) )

What survives is only the redistribution of weight between projects, which is
what aging is supposed to be. The risk-versus-cost balance is left exactly where
the un-aged model put it.

WHY A SINGLE-WEEK SWEEP MEASURES NOTHING
------------------------------------------------------------------------------
Aging needs history to bite. A project never visited has unbounded waiting time,
clamped here to the window, so EVERY never-visited project receives the same
multiplier. With 85 of 100 High/Critical projects never visited, normalisation
then returns almost exactly 1.0 for all of them and alpha has no effect
whatsoever — a flat line, correctly.

That is not a defect in the aging term; it is what aging means. The effect only
appears once some projects have been visited and others have not, which is to
say across successive weeks. The measurement that shows it is therefore a
multi-week simulation (scripts/aging_simulation.py), not a single solve.
"""

from __future__ import annotations

import logging
from typing import Mapping, Optional

import numpy as np
import pandas as pd

logger = logging.getLogger("maagap.aging")

#: Waiting beyond this many weeks stops increasing priority. Without a cap, a
#: project unvisited for a year would dominate the objective regardless of risk,
#: which inverts the system's purpose: this is a risk-driven scheduler with a
#: fairness correction, not a round-robin with a risk tiebreak.
DEFAULT_WINDOW_WEEKS = 12.0

#: Aging strength, and the scheduler's primary anti-starvation mechanism.
#:
#: 2.0 is not a round number picked for comfort. Below alpha = 1.9 aging CANNOT
#: reorder a never-visited High above a one-week-old Critical, because the tier
#: weights dominate:
#:
#:     1.0 * (1 + alpha)  >  2.5 * (1 + alpha / 12)   =>   alpha > 1.9
#:
#: So any value under ~2 looks like a cautious setting and is in fact
#: indistinguishable from switching aging off. The threshold was derived before
#: the sweep rather than fitted after it.
#:
#: Measured over 8 simulated weeks at the validated 60s solver cap
#: (scripts/aging_simulation.py, artifacts/aging_simulation_60s.json):
#:
#:     no cooldown, alpha=0     High  0/22   eff 7.50   <- the original defect
#:     no cooldown, alpha=2     High 20/22   eff 7.19   <- this setting
#:     28d cooldown, alpha=0    High 20/22   eff 5.68
#:
#: 0.0 disables aging and reproduces the pre-R2 objective exactly, which is what
#: the ablation's control arm uses.
DEFAULT_ALPHA = 2.0


def weeks_since_visit(
    project_keys: pd.Series,
    last_visits: Mapping[str, pd.Timestamp],
    *,
    now: Optional[pd.Timestamp] = None,
    window_weeks: float = DEFAULT_WINDOW_WEEKS,
) -> pd.Series:
    """Weeks since each project was last visited, clamped to `window_weeks`.

    A project with no recorded visit is treated as having waited the maximum,
    not as having waited zero. Treating "never visited" as "just visited" would
    give the projects most in need of attention the lowest priority — the exact
    inversion this module exists to prevent.
    """
    reference = now if now is not None else pd.Timestamp.now(tz="UTC")

    def _weeks(key: str) -> float:
        last = last_visits.get(key)
        if last is None or pd.isna(last):
            return window_weeks
        delta_days = (reference - last).total_seconds() / 86400.0
        return float(np.clip(delta_days / 7.0, 0.0, window_weeks))

    return project_keys.map(_weeks).astype(float)


def aging_multipliers(
    weeks: pd.Series,
    alpha: float,
    *,
    window_weeks: float = DEFAULT_WINDOW_WEEKS,
    base_weights: Optional[pd.Series] = None,
    normalize: bool = True,
) -> pd.Series:
    """Per-project objective multipliers.

    With `normalize` and `base_weights`, the result is rescaled so the pool's
    total risk weight is unchanged — isolating the redistribution of priority
    from a change in how risk trades off against cost. See the module docstring;
    skipping this turns an aging sweep into a cost-sensitivity sweep wearing
    aging's name.
    """
    if alpha == 0:
        return pd.Series(np.ones(len(weeks)), index=weeks.index, dtype=float)

    raw = 1.0 + alpha * (weeks.clip(upper=window_weeks) / window_weeks)

    if not normalize:
        return raw
    if base_weights is None:
        mean = raw.mean()
        return raw / mean if mean else raw

    weighted = float((base_weights * raw).sum())
    if weighted <= 0:
        return raw
    return raw * (float(base_weights.sum()) / weighted)


def apply_aging(
    priority_df: pd.DataFrame,
    last_visits: Mapping[str, pd.Timestamp],
    *,
    alpha: float = DEFAULT_ALPHA,
    window_weeks: float = DEFAULT_WINDOW_WEEKS,
    now: Optional[pd.Timestamp] = None,
    normalize: bool = True,
) -> pd.DataFrame:
    """Return `priority_df` with `risk_weight` aged, plus the columns that make
    the adjustment auditable (`weeks_since_visit`, `aging_multiplier`).

    A no-op at alpha = 0, including the column additions, so the control arm of
    an ablation is byte-identical to the pre-R2 pipeline.
    """
    if priority_df.empty or alpha == 0:
        return priority_df

    out = priority_df.copy()
    out["weeks_since_visit"] = weeks_since_visit(
        out["project_key"], last_visits, now=now, window_weeks=window_weeks
    )
    out["aging_multiplier"] = aging_multipliers(
        out["weeks_since_visit"],
        alpha,
        window_weeks=window_weeks,
        base_weights=out["risk_weight"],
        normalize=normalize,
    )
    out["risk_weight"] = out["risk_weight"] * out["aging_multiplier"]

    spread = float(out["aging_multiplier"].max() - out["aging_multiplier"].min())
    logger.info(
        "Aging applied: alpha=%.2f window=%.0fw, multiplier range %.4f-%.4f "
        "(spread %.4f across %d candidates).",
        alpha, window_weeks,
        out["aging_multiplier"].min(), out["aging_multiplier"].max(),
        spread, len(out),
    )
    if spread < 1e-9:
        logger.warning(
            "Aging had NO effect: every candidate has the same waiting time, so "
            "normalisation returns 1.0 for all of them. This is expected when no "
            "visit history exists yet — aging can only redistribute priority once "
            "some projects have been visited and others have not."
        )
    return out
