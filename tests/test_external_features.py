"""
Tests for the external-data feature modules: data_pipeline/external/pagasa.py
and psa.py (D19, D22).

These two modules join eleven years of weather and price data onto every model
row and had no tests. The most important assertion here is the leakage guard.

WHY THE LEAKAGE GUARD MATTERS MORE THAN THE ARITHMETIC
------------------------------------------------------------------------------
The target is built as `T_actual = Date of Completion - D_start` and compared
against T_standard. A weather or price window spanning `[D_start, D_end]` would
therefore have a WINDOW LENGTH EQUAL TO THE PROJECT DURATION -- which is the
label. Rainfall summed over a longer window is mechanically larger, so a
delayed project would look rainier by construction and the model would read the
outcome straight through the feature.

This project has already been bitten by exactly this shape once: the regression
head briefly scored MAE 0.91 days and R2 0.9994 because the target reached its
own design matrix, and it was caught only because the number was implausibly
good. A weather feature would leak more subtly and might look entirely
reasonable. The guard is asserted in code; these tests assert the guard.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from data_pipeline.external import pagasa, psa


# ---------------------------------------------------------------------------
# The leakage guard
# ---------------------------------------------------------------------------

def test_window_constants_are_accepted():
    pagasa.assert_windows_are_outcome_independent(180, 90)


@pytest.mark.parametrize("bad", [0, -1, -180])
def test_non_positive_windows_are_rejected(bad: int):
    with pytest.raises(AssertionError):
        pagasa.assert_windows_are_outcome_independent(bad, 90)
    with pytest.raises(AssertionError):
        pagasa.assert_windows_are_outcome_independent(180, bad)


@pytest.mark.parametrize("bad", [180.5, "180", None, [180]])
def test_non_integer_windows_are_rejected(bad: object) -> None:
    """A window length arriving as anything but a constant integer is the shape
    a duration-derived value would take."""
    with pytest.raises(AssertionError):
        pagasa.assert_windows_are_outcome_independent(bad, 90)  # type: ignore[arg-type]


def test_psa_rejects_a_non_constant_window():
    df = pd.DataFrame({"k": [1]})
    starts = pd.Series(pd.to_datetime(["2019-01-01"]))
    with pytest.raises(AssertionError):
        psa.attach_psa_features(df, starts, window_days=0)


# ---------------------------------------------------------------------------
# Weather window arithmetic, against a hand-built series
# ---------------------------------------------------------------------------

@pytest.fixture
def synthetic_weather(monkeypatch):
    """A year of 1 mm/day rain with three known spikes, and a flat 30 C."""
    dates = pd.date_range("2020-01-01", "2020-12-31", freq="D")
    rain = pd.Series(1.0, index=dates)
    rain.loc["2020-03-01"] = 100.0   # heavy
    rain.loc["2020-03-02"] = 60.0    # heavy
    rain.loc["2020-03-03"] = 0.0     # a genuine dry day
    tmax = pd.Series(30.0, index=dates)
    tmax.loc["2020-06-01":"2020-06-05"] = 36.0   # five hot days
    monkeypatch.setattr(pagasa, "load_daily_weather",
                        lambda: (rain, tmax, (rain >= 50).astype(float)))
    return rain, tmax


def test_rain_totals_match_a_hand_computed_window(synthetic_weather):
    df = pd.DataFrame({"k": [1]})
    starts = pd.Series(pd.to_datetime(["2020-01-01"]))
    out = pagasa.attach_weather_features(df, starts, window_days=10)
    # 1 mm on each of 11 days inclusive of both endpoints.
    assert out["rain_total_mm_180d"].iloc[0] == pytest.approx(11.0, abs=1.0)
    assert out["max_24h_rain_mm_180d"].iloc[0] == pytest.approx(1.0)


def test_heavy_rain_days_counts_only_days_at_or_above_threshold(synthetic_weather):
    df = pd.DataFrame({"k": [1]})
    starts = pd.Series(pd.to_datetime(["2020-02-25"]))
    out = pagasa.attach_weather_features(df, starts, window_days=30)
    assert out["heavy_rain_days_180d"].iloc[0] == pytest.approx(2.0)
    assert out["max_24h_rain_mm_180d"].iloc[0] == pytest.approx(100.0)


def test_a_genuine_zero_rain_day_is_not_counted_as_a_rain_day(synthetic_weather):
    """0 mm is an observation of no rain, and must not be counted as rainfall.
    This is the same distinction the extractor keeps between blank and zero."""
    df = pd.DataFrame({"k": [1]})
    starts = pd.Series(pd.to_datetime(["2020-03-01"]))
    out = pagasa.attach_weather_features(df, starts, window_days=2)
    # 3 days in window, one of which (Mar 3) is a real zero.
    assert out["rain_days_180d"].iloc[0] == pytest.approx(2.0)


def test_hot_days_use_the_temperature_threshold(synthetic_weather):
    df = pd.DataFrame({"k": [1]})
    starts = pd.Series(pd.to_datetime(["2020-05-28"]))
    out = pagasa.attach_weather_features(df, starts, window_days=14)
    assert out["hot_days_180d"].iloc[0] == pytest.approx(5.0)
    assert out["mean_tmax_c_180d"].iloc[0] > 30.0


def test_rows_outside_the_record_are_nan_not_zero(synthetic_weather):
    """A project with no observation is not the same claim as a project with no
    rain. Zero would be invisible in every downstream aggregate."""
    df = pd.DataFrame({"k": [1, 2]})
    starts = pd.Series(pd.to_datetime(["2020-06-01", "1990-01-01"]))
    out = pagasa.attach_weather_features(df, starts, window_days=30)
    assert not np.isnan(out["rain_total_mm_180d"].iloc[0])
    assert np.isnan(out["rain_total_mm_180d"].iloc[1])


def test_missing_reference_leaves_features_nan_rather_than_failing(monkeypatch):
    """A checkout that has not run the extractor must still complete feature
    engineering -- degraded, not broken."""
    monkeypatch.setattr(pagasa, "load_daily_weather", lambda: None)
    out = pagasa.attach_weather_features(pd.DataFrame({"k": [1]}),
                                         pd.Series(pd.to_datetime(["2020-01-01"])))
    for col in pagasa.WEATHER_FEATURES:
        assert col in out.columns
        assert out[col].isna().all()


# ---------------------------------------------------------------------------
# PSA economic features
# ---------------------------------------------------------------------------

@pytest.fixture
def synthetic_cpi(monkeypatch):
    months = pd.date_range("2019-01-01", "2021-12-01", freq="MS")
    frame = pd.DataFrame(
        {
            "cpi_all_items": np.arange(len(months), dtype=float),
            "cpi_housing_utilities": np.arange(len(months), dtype=float) * 2,
            "cpi_repair_materials": np.arange(len(months), dtype=float) * 3,
        },
        index=months,
    )
    monkeypatch.setattr(psa, "load_cpi", lambda: frame)
    return frame


def test_psa_reads_the_value_for_the_start_month(synthetic_cpi):
    df = pd.DataFrame({"k": [1]})
    starts = pd.Series(pd.to_datetime(["2019-04-17"]))  # mid-month
    out = psa.attach_psa_features(df, starts)
    # April 2019 is the 4th month, index 3.
    assert out["cpi_all_items_yoy_at_start"].iloc[0] == pytest.approx(3.0)
    assert out["cpi_repair_materials_yoy_at_start"].iloc[0] == pytest.approx(9.0)


def test_psa_rows_outside_the_series_are_nan(synthetic_cpi):
    df = pd.DataFrame({"k": [1, 2]})
    starts = pd.Series(pd.to_datetime(["2019-06-01", "1995-01-01"]))
    out = psa.attach_psa_features(df, starts)
    assert not np.isnan(out["cpi_all_items_yoy_at_start"].iloc[0])
    assert np.isnan(out["cpi_all_items_yoy_at_start"].iloc[1])


def test_psa_window_mean_spans_the_requested_months(synthetic_cpi):
    df = pd.DataFrame({"k": [1]})
    starts = pd.Series(pd.to_datetime(["2019-01-01"]))
    out = psa.attach_psa_features(df, starts, window_days=90)
    # Months 0..3 of cpi_repair_materials = 0, 3, 6, 9 -> mean 4.5
    assert out["cpi_repair_materials_yoy_mean_180d"].iloc[0] == pytest.approx(4.5, abs=1.6)


def test_psa_missing_reference_leaves_features_nan(monkeypatch):
    monkeypatch.setattr(psa, "load_cpi", lambda: None)
    out = psa.attach_psa_features(pd.DataFrame({"k": [1]}),
                                  pd.Series(pd.to_datetime(["2019-01-01"])))
    for col in psa.PSA_FEATURES:
        assert col in out.columns
        assert out[col].isna().all()


def test_neither_module_emits_a_feature_named_after_the_target():
    """Cheap tripwire: a feature whose name references completion or duration
    would be the visible symptom of a window anchored to the outcome."""
    banned = ("t_actual", "completion", "duration", "redflag", "delay_days")
    for name in list(pagasa.WEATHER_FEATURES) + list(psa.PSA_FEATURES):
        assert not any(b in name.lower() for b in banned), name
