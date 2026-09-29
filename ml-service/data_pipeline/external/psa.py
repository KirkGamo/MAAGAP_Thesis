"""
MAAGAP — PSA Region VI economic indicator features (Objective 1)
================================================================================
Joins Western Visayas consumer price inflation onto project rows, completing the
external-contextual-variable half of Objective 1 alongside the PAGASA weather
block.

SOURCE
------------------------------------------------------------------------------
    data/external/psa_region6_cpi_monthly.csv   2013-01 .. 2026-08

Produced by `scripts/fetch_psa_cpi_region6.py` from PSA OpenSTAT. Three
year-on-year inflation series for Region VI (Western Visayas):

    cpi_all_items          general regional inflation
    cpi_housing_utilities  housing, water, electricity, gas and other fuels
    cpi_repair_materials   materials for maintenance and repair of the dwelling

WHAT THIS IS A PROXY FOR, AND WHY
------------------------------------------------------------------------------
The series one would actually want is a construction-materials price index for
Region VI. PSA publishes construction-materials indices (CMRPI, CMWPI) but
**every one of them is National Capital Region only** -- there is no regional
construction price index for Western Visayas.

That forces a choice between an index that is construction-specific but
describes Metro Manila, and one that describes Western Visayas but is not
construction-specific. This takes the second and narrows it as far as the data
allows: `cpi_repair_materials` is the CPI commodity group for materials used in
maintaining and repairing dwellings -- construction materials, in the right
region, monthly.

It remains a CONSUMER price index. Report it in Chapter 3 as regional consumer
price inflation used as a proxy for construction cost pressure, never as a
construction price index.

LEAKAGE CONSTRAINT
------------------------------------------------------------------------------
Identical to the weather block's: every window is anchored to D_start plus a
CONSTANT, so none can encode the completion date. `[D_start, D_end]` would have
a window length equal to the project duration, which is the label.

EXPECTED CONTRIBUTION
------------------------------------------------------------------------------
Small, and for a sharper reason than the weather block's. These series vary by
MONTH and never by project: every project starting in the same month receives
identical values. The models' single most important feature is already `Year`,
and regional inflation is close to a deterministic function of the calendar.
The genuinely new content is the within-year variation in cost pressure, which
is a much smaller quantity than the inflation trend itself.
"""

from __future__ import annotations

import logging
from functools import lru_cache
from pathlib import Path
from typing import Optional

import numpy as np
import pandas as pd

logger = logging.getLogger("maagap.psa")

REPO_ROOT = Path(__file__).resolve().parents[3]
CPI_PATH = REPO_ROOT / "data" / "external" / "psa_region6_cpi_monthly.csv"

EXECUTION_WINDOW_DAYS = 180  # matches the weather block, for comparability

PSA_FEATURES = [
    "cpi_all_items_yoy_at_start",
    "cpi_housing_yoy_at_start",
    "cpi_repair_materials_yoy_at_start",
    "cpi_repair_materials_yoy_mean_180d",
]


@lru_cache(maxsize=1)
def load_cpi() -> Optional[pd.DataFrame]:
    """Monthly YoY series indexed by month-start, or None when the extract is
    absent -- callers then leave the features NaN rather than failing."""
    if not CPI_PATH.exists():
        logger.warning(
            "PSA CPI series not found at %s — economic features will be NaN. "
            "Run scripts/fetch_psa_cpi_region6.py to produce it.", CPI_PATH,
        )
        return None
    df = pd.read_csv(CPI_PATH, parse_dates=["date"])
    df = df.set_index("date").sort_index()
    return df[["cpi_all_items", "cpi_housing_utilities", "cpi_repair_materials"]]


def attach_psa_features(
    df: pd.DataFrame,
    start_dates: pd.Series,
    window_days: int = EXECUTION_WINDOW_DAYS,
) -> pd.DataFrame:
    """
    Adds the economic block, keyed on the SAME resolved D_start the target and
    the weather block use.

    Rows whose start month falls outside the published series keep NaN: a
    project with no observation is not the same claim as a project in a month
    of zero inflation.
    """
    if not isinstance(window_days, (int, np.integer)) or window_days <= 0:
        raise AssertionError(
            f"window_days must be a positive integer constant, got {window_days!r}. "
            "A window derived from a completion date would encode the label."
        )

    out = df.copy()
    cpi = load_cpi()
    if cpi is None:
        for col in PSA_FEATURES:
            out[col] = np.nan
        return out

    starts = pd.to_datetime(start_dates, errors="coerce")
    month = starts.dt.to_period("M").dt.to_timestamp()

    at_start = cpi.reindex(month.to_numpy())
    out["cpi_all_items_yoy_at_start"] = at_start["cpi_all_items"].to_numpy()
    out["cpi_housing_yoy_at_start"] = at_start["cpi_housing_utilities"].to_numpy()
    out["cpi_repair_materials_yoy_at_start"] = at_start["cpi_repair_materials"].to_numpy()

    # Mean cost pressure over the fixed early-execution window. Computed from a
    # cumulative sum so the cost is one lookup per project rather than a slice.
    series = cpi["cpi_repair_materials"]
    cum = series.fillna(0.0).cumsum()
    cnt = series.notna().astype(float).cumsum()
    lo, hi = series.index.min(), series.index.max()

    def _at(acc: pd.Series, when) -> float:
        if pd.isna(when):
            return np.nan
        when = min(max(when, lo), hi)
        idx = acc.index.searchsorted(when, side="right") - 1
        return float(acc.iloc[idx]) if idx >= 0 else 0.0

    means = []
    for start in month:
        if pd.isna(start) or start < lo or start > hi:
            means.append(np.nan)
            continue
        end = start + pd.Timedelta(days=window_days)
        total = _at(cum, end) - _at(cum, start)
        n = _at(cnt, end) - _at(cnt, start)
        means.append(total / n if n > 0 else np.nan)
    out["cpi_repair_materials_yoy_mean_180d"] = means

    covered = int(pd.Series(out["cpi_all_items_yoy_at_start"]).notna().sum())
    logger.warning(
        "PSA Region VI CPI: %d/%d rows (%.1f%%) fall inside the published series "
        "(%s..%s); the rest keep NaN rather than a fabricated zero.",
        covered, len(out), 100.0 * covered / max(len(out), 1), lo.date(), hi.date(),
    )
    return out
