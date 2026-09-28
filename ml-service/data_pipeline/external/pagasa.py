"""
MAAGAP — PAGASA weather features (Objective 1's external contextual variables)
================================================================================
Joins the extracted PAGASA daily series onto project rows as a small block of
window aggregates, replacing `is_wet_season_release` as the pipeline's weather
signal.

SOURCE
------------------------------------------------------------------------------
    data/external/pagasa_iloilo_precipitation_daily.csv   2015-01-01 .. 2026-09-30
    data/external/pagasa_iloilo_temperature_daily.csv     2016-05-01 .. 2026-09-30

Produced by `scripts/extract_pagasa_pdfs.py` from station ILOILO RADAR (98637,
Jaro). See that script for the extraction's own QC, including the four pages
whose printed sums disagree with their daily rows and the three days the source
contradicts itself on.

THE LEAKAGE CONSTRAINT — the reason every window is anchored to D_start alone
------------------------------------------------------------------------------
`T_actual = Date of Completion - D_start`, and RedFlag compares it against
T_standard. A weather aggregate over `[D_start, D_end]` would therefore have a
WINDOW LENGTH EQUAL TO THE PROJECT DURATION, which is the label: rainfall summed
over a longer window is mechanically larger, so a delayed project would look
rainier by construction and the model would read the outcome through the
feature.

Every window below is anchored to D_start plus a CONSTANT. None can encode the
outcome, and all are computable for an ongoing project that has no completion
date at all — which matters because the optimizer scores exactly that
population.

`assert_windows_are_outcome_independent()` states this as an executable check
rather than a comment, in the spirit of train_regressors.build_design_matrix()'s
guard: the denylist approach fails open, so the assertion is the part that
prevents recurrence.

WHY A FIXED 180-DAY WINDOW RATHER THAN THE SCHEDULED ONE
------------------------------------------------------------------------------
`[D_start, D_start + T_standard]` is the obvious choice, but T_standard takes
only two values (365 days Infrastructure, 182 Non-Infrastructure) and is a
deterministic function of project_type, which is already a feature. A window
whose LENGTH varied with project type would make every rainfall total partly an
encoding of project type, and the model could learn the split rather than the
weather. A fixed 180-day window is identical for every project, so totals are
directly comparable, and it still covers the critical early execution phase.

WHAT THESE FEATURES CAN AND CANNOT DO
------------------------------------------------------------------------------
ONE station serves all 44 Iloilo LGUs. These values vary by DATE and never by
LOCATION: two projects running concurrently at opposite ends of the province
receive identical weather. They can describe temporal variation in delay; they
cannot distinguish between concurrent projects by where they are. Any claim
built on them inherits that limit, and Objective 1 should say *provincial*
weather rather than project-site weather.
"""

from __future__ import annotations

import logging
from functools import lru_cache
from pathlib import Path
from typing import Optional

import numpy as np
import pandas as pd

logger = logging.getLogger("maagap.pagasa")

REPO_ROOT = Path(__file__).resolve().parents[3]
EXTERNAL_DIR = REPO_ROOT / "data" / "external"
PRECIP_PATH = EXTERNAL_DIR / "pagasa_iloilo_precipitation_daily.csv"
TEMP_PATH = EXTERNAL_DIR / "pagasa_iloilo_temperature_daily.csv"

# Window lengths, in days. Constants, never derived from an outcome.
EXECUTION_WINDOW_DAYS = 180
ANTECEDENT_WINDOW_DAYS = 90

HEAVY_RAIN_MM = 50.0   # PAGASA's "heavy" 24-hour rainfall threshold.
HOT_DAY_TMAX_C = 35.0  # Heat at which outdoor work and concrete curing suffer.

# Physically impossible readings, reported by the extractor and excluded here
# rather than silently averaged in. See D19.
TMIN_FLOOR_C, TMAX_CEILING_C = 15.0, 42.0

WEATHER_FEATURES = [
    "rain_total_mm_180d",
    "rain_days_180d",
    "heavy_rain_days_180d",
    "max_24h_rain_mm_180d",
    "mean_tmax_c_180d",
    "hot_days_180d",
    "rain_total_mm_prior_90d",
]


def assert_windows_are_outcome_independent(
    window_days: int = EXECUTION_WINDOW_DAYS,
    antecedent_days: int = ANTECEDENT_WINDOW_DAYS,
) -> None:
    """Executable statement of the constraint in this module's docstring: every
    window offset must be a positive constant, never anything derived from a
    completion date or duration."""
    for name, value in (("execution", window_days), ("antecedent", antecedent_days)):
        if not isinstance(value, (int, np.integer)) or value <= 0:
            raise AssertionError(
                f"{name} window must be a positive integer constant, got {value!r}. "
                "A window derived from a completion date would encode the label."
            )


@lru_cache(maxsize=1)
def load_daily_weather() -> Optional[tuple[pd.Series, pd.Series, pd.Series]]:
    """
    Daily rainfall (mm), daily Tmax (C) and a heavy-rain indicator, each indexed
    by date. Returns None when the extracted CSVs are absent, so a checkout that
    has not run the extractor still completes feature engineering with weather
    features left as NaN rather than failing.
    """
    if not PRECIP_PATH.exists():
        logger.warning(
            "PAGASA daily series not found at %s — weather features will be NaN. "
            "Run scripts/extract_pagasa_pdfs.py to produce it.", PRECIP_PATH,
        )
        return None

    rain = pd.read_csv(PRECIP_PATH, parse_dates=["date"])
    rain_s = rain.set_index("date")["rain_24h_mm"].astype(float).sort_index()
    rain_s = rain_s[~rain_s.index.duplicated(keep="first")]

    if TEMP_PATH.exists():
        temp = pd.read_csv(TEMP_PATH, parse_dates=["date"])
        tmax_s = temp.set_index("date")["tmax_c"].astype(float).sort_index()
        tmax_s = tmax_s[~tmax_s.index.duplicated(keep="first")]
        # Drop the physically impossible readings the extractor flagged rather
        # than averaging them in; they are reported there, excluded here.
        tmax_s = tmax_s.where((tmax_s >= TMIN_FLOOR_C) & (tmax_s <= TMAX_CEILING_C))
    else:
        logger.warning("PAGASA temperature series not found at %s.", TEMP_PATH)
        tmax_s = pd.Series(dtype=float)

    return rain_s, tmax_s, (rain_s >= HEAVY_RAIN_MM).astype(float)


def _window_stats(
    starts: pd.Series,
    rain: pd.Series,
    tmax: pd.Series,
    window_days: int,
    antecedent_days: int,
) -> pd.DataFrame:
    """
    Aggregates each project's windows via cumulative sums over the daily series,
    so the cost is O(n_projects) lookups rather than O(n_projects x window) slices.
    """
    out = pd.DataFrame(index=starts.index, columns=WEATHER_FEATURES, dtype=float)
    if rain.empty:
        return out

    # Reindex onto a complete daily calendar so a missing day is a gap, not a
    # shifted position. Missing days contribute 0 to sums and are excluded from
    # counts and means by the notna mask below.
    cal = pd.date_range(rain.index.min(), rain.index.max(), freq="D")
    r = rain.reindex(cal)
    t = tmax.reindex(cal) if not tmax.empty else pd.Series(index=cal, dtype=float)

    frames = {
        "rain_sum": r.fillna(0.0).cumsum(),
        "rain_days": (r > 0).astype(float).cumsum(),
        "heavy_days": (r >= HEAVY_RAIN_MM).astype(float).cumsum(),
        "tmax_sum": t.fillna(0.0).cumsum(),
        "tmax_n": t.notna().astype(float).cumsum(),
        "hot_days": (t >= HOT_DAY_TMAX_C).astype(float).cumsum(),
    }
    lo, hi = cal.min(), cal.max()

    def _at(series: pd.Series, when: pd.Timestamp) -> float:
        """Cumulative value at `when`, clamped to the series' own span."""
        if pd.isna(when):
            return np.nan
        when = min(max(when, lo), hi)
        idx = series.index.searchsorted(when, side="right") - 1
        return float(series.iloc[idx]) if idx >= 0 else 0.0

    for i, start in starts.items():
        if pd.isna(start) or start < lo or start > hi:
            continue  # outside the observed record; left NaN, counted by caller
        end = start + pd.Timedelta(days=window_days)
        prior = start - pd.Timedelta(days=antecedent_days)

        total = _at(frames["rain_sum"], end) - _at(frames["rain_sum"], start)
        ndays = _at(frames["rain_days"], end) - _at(frames["rain_days"], start)
        heavy = _at(frames["heavy_days"], end) - _at(frames["heavy_days"], start)
        tsum = _at(frames["tmax_sum"], end) - _at(frames["tmax_sum"], start)
        tn = _at(frames["tmax_n"], end) - _at(frames["tmax_n"], start)
        hot = _at(frames["hot_days"], end) - _at(frames["hot_days"], start)
        prior_total = _at(frames["rain_sum"], start) - _at(frames["rain_sum"], prior)

        window = r.loc[start:end]
        out.at[i, "rain_total_mm_180d"] = total
        out.at[i, "rain_days_180d"] = ndays
        out.at[i, "heavy_rain_days_180d"] = heavy
        out.at[i, "max_24h_rain_mm_180d"] = float(window.max()) if window.notna().any() else np.nan
        out.at[i, "mean_tmax_c_180d"] = (tsum / tn) if tn > 0 else np.nan
        out.at[i, "hot_days_180d"] = hot
        out.at[i, "rain_total_mm_prior_90d"] = prior_total

    return out


def attach_weather_features(
    df: pd.DataFrame,
    start_dates: pd.Series,
    window_days: int = EXECUTION_WINDOW_DAYS,
    antecedent_days: int = ANTECEDENT_WINDOW_DAYS,
) -> pd.DataFrame:
    """
    Adds the weather block to `df`, keyed on `start_dates` (the SAME resolved
    D_start the target was built from — not a recomputation from raw columns,
    which is the inconsistency engineer_features' own docstring warns about).

    Rows outside the weather record keep NaN rather than 0: a project with no
    observation is not the same claim as a project with no rain.
    """
    assert_windows_are_outcome_independent(window_days, antecedent_days)

    df = df.copy()
    loaded = load_daily_weather()
    if loaded is None:
        for col in WEATHER_FEATURES:
            df[col] = np.nan
        return df

    rain, tmax, _ = loaded
    starts = pd.to_datetime(start_dates, errors="coerce")
    stats = _window_stats(starts, rain, tmax, window_days, antecedent_days)
    for col in WEATHER_FEATURES:
        df[col] = stats[col].to_numpy()

    covered = int(stats["rain_total_mm_180d"].notna().sum())
    logger.warning(
        "PAGASA weather: %d/%d rows (%.1f%%) fall inside the observed record "
        "(%s..%s); the rest keep NaN rather than a fabricated zero.",
        covered, len(df), 100.0 * covered / max(len(df), 1),
        rain.index.min().date(), rain.index.max().date(),
    )
    return df
