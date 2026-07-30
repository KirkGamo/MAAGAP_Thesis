"""
Phase 14: unit tests for ml-service/data_pipeline/feature_engineering.py's
proxy-completion-date recovery (Phase 6) and empirical lag-correction
(Phase 7) logic -- the two pieces of business logic the Phase 14 audit
flagged as having no automated coverage despite being load-bearing for the
RedFlag target variable's correctness.

These tests build small, hand-constructed DataFrames rather than reading
data/ready/*.csv, so they exercise the logic in isolation and don't depend
on (or break when someone regenerates) the real pipeline's data files.
"""

import pandas as pd
import pytest

from data_pipeline.feature_engineering import (
    compute_empirical_lag_days,
    compute_proxy_completion_dates,
    construct_target_variable,
    FeatureEngineeringReport,
)


# ---------------------------------------------------------------------------
# compute_proxy_completion_dates
# ---------------------------------------------------------------------------


def test_proxy_date_prefers_later_of_monitoring_and_linked_liquidation():
    """When a row has BOTH its own DATE MONITORED value and a crosswalk-linked
    liquidation record, the proxy date is the LATER of the two (per the
    function's docstring), not the monitoring date alone."""
    monitoring_raw = pd.DataFrame(
        {"DATE MONITORED": pd.to_datetime(["2024-06-01"])},
        index=[0],
    )
    liquidation = pd.DataFrame(
        {"Date Submitted": pd.to_datetime(["2024-06-20"])},
        index=[0],
    )
    crosswalk = pd.DataFrame({"mon_row_id": [0], "liq_row_id": [0]})

    proxy = compute_proxy_completion_dates(monitoring_raw, liquidation, crosswalk)

    assert proxy.loc[0] == pd.Timestamp("2024-06-20")


def test_proxy_date_falls_back_to_monitoring_date_when_no_liquidation_link():
    """A row with no crosswalk link at all still recovers a proxy date from
    its own DATE MONITORED value, if one exists."""
    monitoring_raw = pd.DataFrame(
        {"DATE MONITORED": pd.to_datetime(["2024-05-15"])},
        index=[0],
    )
    liquidation = pd.DataFrame({"Date Submitted": pd.to_datetime([])}, index=[])
    crosswalk = pd.DataFrame({"mon_row_id": [], "liq_row_id": []})

    proxy = compute_proxy_completion_dates(monitoring_raw, liquidation, crosswalk)

    assert proxy.loc[0] == pd.Timestamp("2024-05-15")


def test_proxy_date_is_nat_when_nothing_recoverable():
    """No monitoring date and no crosswalk link at all -> NaT, i.e. genuinely
    unresolvable -- this is the case construct_target_variable must route to
    inference.csv rather than guess at."""
    monitoring_raw = pd.DataFrame({"DATE MONITORED": [pd.NaT]}, index=[0])
    liquidation = pd.DataFrame({"Date Submitted": pd.to_datetime([])}, index=[])
    crosswalk = pd.DataFrame({"mon_row_id": [], "liq_row_id": []})

    proxy = compute_proxy_completion_dates(monitoring_raw, liquidation, crosswalk)

    assert pd.isna(proxy.loc[0])


# ---------------------------------------------------------------------------
# compute_empirical_lag_days
# ---------------------------------------------------------------------------


def test_empirical_lag_uses_median_not_mean_of_calibration_rows():
    """Two calibration rows with lags of 10 and 20 days -> median is 15, not
    the mean (also 15 here, so add a third row that would pull the mean but
    not the median, to actually distinguish the two)."""
    d_end_direct = pd.Series(
        pd.to_datetime(["2024-01-01", "2024-02-01", "2024-03-01"])
    )
    # lags: +10, +20, +100 days -> mean = 43.3, median = 20
    proxy_dates_all = pd.Series(
        pd.to_datetime(["2024-01-11", "2024-02-21", "2024-06-09"])
    )

    median_lag, n_calibration = compute_empirical_lag_days(d_end_direct, proxy_dates_all)

    assert n_calibration == 3
    assert median_lag == pytest.approx(20.0)


def test_empirical_lag_only_uses_rows_with_both_dates_present():
    """A row missing either the direct or the proxy date must not count
    toward calibration -- only genuinely comparable rows should."""
    d_end_direct = pd.Series(pd.to_datetime(["2024-01-01", None, "2024-03-01"]))
    proxy_dates_all = pd.Series(pd.to_datetime(["2024-01-11", "2024-02-21", None]))

    median_lag, n_calibration = compute_empirical_lag_days(d_end_direct, proxy_dates_all)

    # Only index 0 has both a direct and a proxy date (index 1 has no direct
    # date, index 2 has no proxy date).
    assert n_calibration == 1
    assert median_lag == pytest.approx(10.0)


def test_empirical_lag_returns_zero_when_no_calibration_rows_exist():
    """If nothing overlaps, the function must not raise or fabricate a
    correction -- it returns an explicit zero-lag, zero-n result and lets
    the caller use proxy dates uncorrected."""
    d_end_direct = pd.Series(pd.to_datetime([None, None]))
    proxy_dates_all = pd.Series(pd.to_datetime(["2024-01-01", "2024-02-01"]))

    median_lag, n_calibration = compute_empirical_lag_days(d_end_direct, proxy_dates_all)

    assert median_lag == 0.0
    assert n_calibration == 0


# ---------------------------------------------------------------------------
# construct_target_variable -- integration of proxy recovery + lag correction
# ---------------------------------------------------------------------------


def _make_monitoring_row(**overrides):
    base = {
        "DATE RELEASED": pd.NaT,
        "DATE MONITORED": pd.NaT,
        "Date  of Completion": pd.NaT,  # sic: double space, matches the real column name
        "project_type": "Infrastructure",
        "STATUS_clean": "",
        "REMARKS": "",
    }
    base.update(overrides)
    return base


def test_construct_target_variable_direct_date_ignores_status():
    """A row with a direct completion date is scored from that date
    regardless of STATUS -- proxy recovery never even needs to run for it."""
    monitoring = pd.DataFrame([
        _make_monitoring_row(
            **{
                "DATE RELEASED": "2024-01-01",
                "Date  of Completion": "2025-01-11",  # 376 days later
                "project_type": "Infrastructure",  # standard = 365 days
                "STATUS_clean": "on-going",  # deliberately inconsistent w/ having a completion date
            }
        )
    ])
    liquidation = pd.DataFrame({"Date Submitted": pd.to_datetime([])}, index=[])
    crosswalk = pd.DataFrame({"mon_row_id": [], "liq_row_id": []})

    result = construct_target_variable(monitoring, liquidation, crosswalk, FeatureEngineeringReport())

    assert result.loc[0, "completion_date_is_proxy"] == False  # noqa: E712
    assert result.loc[0, "RedFlag"] == 1  # 376 > 365


def test_construct_target_variable_recovers_via_lag_corrected_proxy():
    """End-to-end: two calibration rows (direct date known + a linked
    liquidation date) establish a median lag of 15 days; a third row with no
    direct date but a completed STATUS and a linked liquidation date gets a
    PROXY completion date, corrected by that same 15-day median, and is
    scored from it."""
    monitoring = pd.DataFrame([
        # Row 0: calibration -- direct date known, proxy recoverable via its
        # own DATE MONITORED (no liquidation link needed). Lag = 10 days.
        _make_monitoring_row(**{
            "DATE RELEASED": "2024-01-01",
            "Date  of Completion": "2024-03-01",
            "DATE MONITORED": "2024-03-11",  # 10 days after direct completion
            "project_type": "Infrastructure",
            "STATUS_clean": "completed/functional",
        }),
        # Row 1: calibration -- lag = 20 days, via its own DATE MONITORED.
        _make_monitoring_row(**{
            "DATE RELEASED": "2024-01-01",
            "Date  of Completion": "2024-04-01",
            "DATE MONITORED": "2024-04-21",  # 20 days after direct completion
            "project_type": "Infrastructure",
            "STATUS_clean": "completed/functional",
        }),
        # Row 2: the row under test -- no direct date, STATUS confirms
        # completed, recoverable via a linked liquidation record only.
        # Raw proxy = 2024-08-01; median calibration lag = 15 days ->
        # corrected proxy = 2024-07-17. D_start = 2024-01-01, so T_actual =
        # 198 days. project_type = Non-Infrastructure -> standard = 182 days
        # -> 198 > 182 -> RedFlag should be 1.
        _make_monitoring_row(**{
            "DATE RELEASED": "2024-01-01",
            "Date  of Completion": pd.NaT,
            "project_type": "Non-Infrastructure",
            "STATUS_clean": "completed/functional",
        }),
        # Row 3: STATUS does NOT confirm completion -> must stay unresolved
        # (Phase 3 protection) even though nothing else prevents scoring it.
        _make_monitoring_row(**{
            "DATE RELEASED": "2024-01-01",
            "project_type": "Non-Infrastructure",
            "STATUS_clean": "on-going",
        }),
        # Row 4: STATUS confirms completed, but nothing recoverable at all
        # (no own monitoring date, no crosswalk link) -> stays unresolved.
        _make_monitoring_row(**{
            "DATE RELEASED": "2024-01-01",
            "project_type": "Non-Infrastructure",
            "STATUS_clean": "completed/functional",
        }),
    ])
    liquidation = pd.DataFrame(
        {"Date Submitted": pd.to_datetime(["2024-08-01"])}, index=[0]
    )
    # Only row 2 (mon_row_id=2) is linked to a liquidation record (liq_row_id=0).
    crosswalk = pd.DataFrame({"mon_row_id": [2], "liq_row_id": [0]})

    report = FeatureEngineeringReport()
    result = construct_target_variable(monitoring, liquidation, crosswalk, report)

    # Calibration rows: scored directly, not treated as proxies.
    assert result.loc[0, "completion_date_is_proxy"] == False  # noqa: E712
    assert result.loc[1, "completion_date_is_proxy"] == False  # noqa: E712

    # Row 2: recovered via a lag-corrected proxy date.
    assert result.loc[2, "completion_date_is_proxy"] == True  # noqa: E712
    assert result.loc[2, "RedFlag"] == 1
    assert result.loc[2, "T_actual_days"] == 198

    # Row 3: STATUS doesn't confirm completion -> unresolved regardless of
    # what else might be recoverable.
    assert result.loc[3, "completion_date_is_proxy"] == False  # noqa: E712
    assert pd.isna(result.loc[3, "RedFlag"])

    # Row 4: completed STATUS but nothing recoverable -> still unresolved.
    assert result.loc[4, "completion_date_is_proxy"] == False  # noqa: E712
    assert pd.isna(result.loc[4, "RedFlag"])

    # The report should reflect the same 15-day median lag calibrated from
    # exactly 2 rows.
    assert report.target_construction["lag_correction_median_days"] == pytest.approx(15.0)
    assert report.target_construction["lag_correction_calibration_n"] == 2
    assert report.target_construction["rows_labeled_via_proxy_date"] == 1


def test_construct_target_variable_clamp_overshoot_vs_raw_invalid():
    """Phase 8 clamp: distinguishes rows where lag correction alone pushes a
    credible raw proxy date non-credible (clamp at D_start+1, RedFlag=0 by
    construction) from rows where even the RAW proxy date already precedes
    D_start (no real event to anchor to -- stays unresolved, never clamped).
    Same 15-day calibration lag as the sibling test above."""
    monitoring = pd.DataFrame([
        _make_monitoring_row(**{
            "DATE RELEASED": "2024-01-01",
            "Date  of Completion": "2024-03-01",
            "DATE MONITORED": "2024-03-11",
            "project_type": "Infrastructure",
            "STATUS_clean": "completed/functional",
        }),
        _make_monitoring_row(**{
            "DATE RELEASED": "2024-01-01",
            "Date  of Completion": "2024-04-01",
            "DATE MONITORED": "2024-04-21",
            "project_type": "Infrastructure",
            "STATUS_clean": "completed/functional",
        }),
        # Row 2: correction overshoot -- raw proxy (own DATE MONITORED) is
        # 2024-01-10, 9 days after D_start (2024-01-01) -- a real, credible
        # event after start. The 15-day median lag correction alone pulls
        # it to 2023-12-26, before D_start -- non-credible only because of
        # the flat correction. Should be CLAMPED to D_start+1 (2024-01-02),
        # T_actual=1, RedFlag=0 (mechanically, not from evidence).
        _make_monitoring_row(**{
            "DATE RELEASED": "2024-01-01",
            "DATE MONITORED": "2024-01-10",
            "project_type": "Non-Infrastructure",
            "STATUS_clean": "completed/functional",
        }),
        # Row 3: raw invalid -- own DATE MONITORED (2023-12-15) already
        # precedes D_start (2024-01-01) before any lag correction is even
        # applied. No real event to anchor to -- must stay unresolved, NOT
        # clamped, regardless of STATUS confirming completion.
        _make_monitoring_row(**{
            "DATE RELEASED": "2024-01-01",
            "DATE MONITORED": "2023-12-15",
            "project_type": "Non-Infrastructure",
            "STATUS_clean": "completed/functional",
        }),
    ])
    liquidation = pd.DataFrame({"Date Submitted": pd.to_datetime([])})
    crosswalk = pd.DataFrame({"mon_row_id": pd.Series(dtype="int64"), "liq_row_id": pd.Series(dtype="int64")})

    report = FeatureEngineeringReport()
    result = construct_target_variable(monitoring, liquidation, crosswalk, report)

    # Row 2: clamped -- usable, but flagged as a construction artifact.
    assert result.loc[2, "completion_date_is_proxy"] == True  # noqa: E712
    assert result.loc[2, "completion_date_is_clamped"] == True  # noqa: E712
    assert result.loc[2, "T_actual_days"] == 1
    assert result.loc[2, "RedFlag"] == 0

    # Row 3: raw invalid -- unresolved, never clamped.
    assert result.loc[3, "completion_date_is_proxy"] == False  # noqa: E712
    assert result.loc[3, "completion_date_is_clamped"] == False  # noqa: E712
    assert pd.isna(result.loc[3, "RedFlag"])

    assert report.target_construction["rows_labeled_via_clamped_proxy_date"] == 1
