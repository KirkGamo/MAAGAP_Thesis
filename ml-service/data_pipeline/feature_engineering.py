"""
MAAGAP Feature Engineering Pipeline — Steps 6-11
================================================================================
Continues the Chapter 3 "Data Collection and Preparation" protocol from where
preprocess.py (Steps 1-5) and scripts/generate_synthetic_data.py leave off,
producing the final model-ready artifacts for the Level 0 base learners.

    Step 6   Target variable construction (Red Flag / Negative Slippage)
    Step 7   Missing-value imputation (IterativeImputer / MICE)
    Step 8   Outlier detection (IQR on log-transformed cost, stratified)
    Step 9   Feature engineering (one-hot encoding, temporal features)
    Step 10  Sequence assembly for LSTM (per-project, per-period panel)
    Step 11  Normalization & project-level 70/30 train/test split

BUSINESS LOGIC CORRECTION (Phase 3): a row missing 'Date  of Completion' is
NOT treated as missing data to be resolved or guessed at merely because the
date cell is blank. Such rows never receive a fabricated RedFlag label, are
never imputed, and are routed to data/ready/inference.csv (+
lstm_inference_sequences.npy) instead of train.csv/test.csv UNLESS a genuine
proxy completion date can be recovered (see Phase 6 note below). This is the
live population the MAAGAP dashboard scores; mixing a fabricated outcome
into training data for a project still in progress would be target leakage
in the most literal sense.

UNIVERSAL DATA RECOVERY (Phase 6): a second, distinct data-quality finding
narrowed the scope of the Phase 3 correction. Across the ENTIRE monitoring
sheet (not just 2023-2026), 8,164 of 8,677 rows (94%) have a blank/NA 'Date
of Completion' cell — but the overwhelming majority of those rows' STATUS
field reads some variant of "Completed"/"Completed/Functional" (roughly
6,800 of the 8,164, per a direct count against the raw workbook). A blank
completion-date cell on a project PPDO's own STATUS field says IS finished
is a data-ENTRY gap, not evidence the project is still running — treating
every blank date as "ongoing" was over-broad and discarded real, resolvable
history. `construct_target_variable` now distinguishes three cases per row
missing a completion date:
    1. STATUS confirms completed/functional AND a real, independently-
       recorded event date can be recovered (the latest of that project's
       own DATE MONITORED value or its linked Liquidation Report Con "Date
       Submitted", via the Step 3 crosswalk) -> that recovered date is used
       as a PROXY completion date, RedFlag is computed from it exactly as
       for a directly-observed date, and `completion_date_is_proxy=True`
       flags the row so this is never confused with directly-observed
       ground truth in downstream reporting.
    2. STATUS confirms completed/functional but NO recoverable event date
       exists (no monitoring visit, no linked liquidation record) -> still
       unresolved; routed to inference.csv (we know the outcome occurred
       but genuinely cannot date it, so labeling it would still be a guess).
    3. STATUS does not confirm completed (On-going, Not Implemented, For
       Bidding, For Implementation, or unmapped/missing STATUS) -> routed to
       inference.csv exactly as before; the Phase 3 protection against
       fabricating an outcome for a project that has not (confirmedly)
       finished is fully preserved for this case.
This is a genuine data-recovery technique, not a return to the earlier
"backfill with synthesized dates" mistake the Phase 3 correction removed:
every proxy date is a REAL, independently-recorded PPDO event (an actual
field visit or an actual liquidation submission), never a value drawn from a
statistical distribution. It is still an approximation — the true
completion date is very likely somewhat earlier than the last administrative
touch recorded against the project — which is exactly why it is flagged via
`completion_date_is_proxy` rather than silently merged into ground truth.

Expected inputs (produced by earlier pipeline stages):
    - data/synthetic/monitoring_with_contractors.csv (preferred), or
      data/processed/monitoring_cleaned.csv (fallback — without the
      synthetic contractor_id join)
    - data/synthetic/contractor_profiles.csv (optional)
    - data/processed/fund_transfer_cleaned.csv
    - data/processed/liquidation_cleaned.csv
    - data/processed/project_crosswalk.csv

Usage:
    python feature_engineering.py \
        --monitoring-input ../../data/synthetic/monitoring_with_contractors.csv \
        --contractors-input ../../data/synthetic/contractor_profiles.csv \
        --fund-transfer-input ../../data/processed/fund_transfer_cleaned.csv \
        --liquidation-input ../../data/processed/liquidation_cleaned.csv \
        --crosswalk-input ../../data/processed/project_crosswalk.csv \
        --output-dir ../../data/ready

Requires: pandas, numpy, scikit-learn (see ml-service/requirements.txt)
================================================================================
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

import numpy as np
import pandas as pd
from sklearn.experimental import enable_iterative_imputer  # noqa: F401 -- registers IterativeImputer
from sklearn.impute import IterativeImputer

try:
    from .preprocess import STANDARD_DURATION_DAYS, canonicalize_municipality
except ImportError:  # running this file directly (not as part of the package)
    from preprocess import STANDARD_DURATION_DAYS, canonicalize_municipality

logger = logging.getLogger("maagap.feature_engineering")


def configure_logging(level: str = "INFO") -> None:
    logging.basicConfig(
        level=getattr(logging, level.upper(), logging.INFO),
        format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
        handlers=[logging.StreamHandler(sys.stdout)],
        force=True,
    )


DATASET_HORIZON = pd.Timestamp("2026-07-27")
RANDOM_SEED_DEFAULT = 42
MAX_LSTM_SEQUENCE_LENGTH = 5

# Exact-duplicate raw monitoring rows (Phase 11, DQ-11): same project name,
# release date, monitoring date, and amount, but a DIFFERENT source row
# (mon_row_id) -- confirmed via a 2026-08-15 audit to be genuine duplicate
# ledger entries, not a crosswalk/join artifact (see D11-Exact-Duplicate-Removal.md).
DUPLICATE_ROW_KEY_COLUMNS = ["NAME OF PROJECT", "DATE RELEASED", "DATE MONITORED", "AMOUNT (Php)"]

# A 2026-08-15 verification session found 3 labeled rows (D_start 2010-01-17,
# 2010-12-27, 2013-09-26) that are 8-13 years before every peer in their own
# monitoring batch -- almost certainly data-entry errors. Chapter 1's stated
# "2016-2025" study period was the FIRST candidate for a cutoff, but was
# rejected: it also silently swept up 381 legitimate-looking 2015 rows that
# were never shown to be erroneous (deviation from their own batch's Year is
# only -2 to -5, well within the normal administrative-lag range -- see
# BATCH_YEAR_DEVIATION_THRESHOLD_YEARS below). The actually well-evidenced
# boundary is the DATA's own natural gap: zero rows anywhere in the full
# 8,784-row population have D_start in 2011, 2012, or 2014 -- the 3 known-bad
# rows sit isolated below that gap, and 2015 onward is a contiguous run. This
# is what STUDY_PERIOD_START encodes -- a gap actually present in the data,
# not a blanket reading of the manuscript's stated scope (see
# D09-Study-Period-Floor.md for the full before/after comparison).
STUDY_PERIOD_START = pd.Timestamp("2015-01-01")

# Diagnostic-only (Phase 9): flags, but never auto-drops, a labeled row whose
# D_start deviates from its own monitoring batch's `Year` column by more than
# this many years, for manual review in date_anomaly_review.csv. A lower
# threshold (4) was tried first and rejected -- deviations of 3-6 years turn
# out to be the NORMAL shape of this dataset (hundreds of rows, since a
# monitoring-report batch routinely reviews projects released several years
# earlier), not a rare signal. 6 isolates a small, genuinely unusual tail
# (6 rows full-population) rather than flooding the review file with
# ordinary administrative lag. Deliberately a soft/reviewable threshold, not
# a defended cutoff like STUDY_PERIOD_START.
BATCH_YEAR_DEVIATION_THRESHOLD_YEARS = 6

# Keywords in monitoring REMARKS that plausibly indicate a verified weather/
# environmental cause for delay, per the Chapter 1 Red Flag delimitation.
#
# IMPORTANT LIMITATION (real, not cosmetic): REMARKS in this workbook is
# populated as a *liquidation-status* field ("Liquidated" / "Unliquidated as
# per office record" / etc. — see Data Audit Report Finding DQ-3), not a
# delay-justification narrative. There is no dedicated free-text field
# recording *why* a project was delayed anywhere in the source workbook. This
# keyword scan is therefore expected to match rarely, Extension_Approved
# defaults to False whenever it doesn't match, and the resulting RedFlag
# target is almost certainly an over-count of "unjustified" delays relative
# to what the manuscript's Chapter 1 definition intends. This should be
# called out explicitly in the thesis if the target variable is used as-is;
# resolving it requires either a genuine delay-reason column from PPDO or a
# documented decision to drop the extension carve-out from the definition.
WEATHER_EXTENSION_KEYWORDS = [
    "typhoon", "bagyo", "flood", "landslide", "calamity", "force majeure",
    "el niño", "el nino", "la niña", "la nina", "weather", "storm",
]

# Substring checks used to classify STATUS for the Phase 6 universal proxy-
# date recovery. Deliberately substring-based rather than an exact-match
# against STATUS_LOOKUP's canonical labels: the raw workbook contains dozens
# of unmapped spelling variants of "Completed/Functional" (e.g. "Completed/
# Fuctional", "Completed/ Funtional", "100% Completed") that STATUS_LOOKUP's
# exact-match dictionary does not cover and that would otherwise fall through
# to a title-cased raw string, invisible to an exact-match check. Every
# variant observed in the raw data keeps the "complet" prefix intact even
# where "functional" itself is misspelled, so a substring check reliably
# catches all of them without having to enumerate every typo by hand.
COMPLETED_STATUS_SUBSTRINGS = ["complet"]
ONGOING_STATUS_SUBSTRINGS = ["ongoing", "on-going", "on going", "on- going"]


@dataclass
class FeatureEngineeringReport:
    target_construction: dict = field(default_factory=dict)
    imputation: dict = field(default_factory=dict)
    outliers: dict = field(default_factory=dict)
    sequence_assembly: dict = field(default_factory=dict)
    split: dict = field(default_factory=dict)

    def log_summary(self) -> None:
        logger.info("=" * 78)
        logger.info("FEATURE ENGINEERING DIAGNOSTIC SUMMARY")
        logger.info("=" * 78)
        for section_name, section in [
            ("Step 6: Target construction", self.target_construction),
            ("Step 7: Imputation", self.imputation),
            ("Step 8: Outliers", self.outliers),
            ("Step 10: Sequence assembly", self.sequence_assembly),
            ("Step 11: Train/test split", self.split),
        ]:
            logger.info("-- %s --", section_name)
            for k, v in section.items():
                logger.info("  %s: %s", k, v)
        logger.info("=" * 78)


# ==============================================================================
# STEP 6 — Target variable construction
# ==============================================================================

def compute_proxy_completion_dates(
    monitoring_raw: pd.DataFrame, liquidation: pd.DataFrame, crosswalk: pd.DataFrame,
) -> pd.Series:
    """
    Phase 6 universal data recovery: for each row of the RAW monitoring sheet
    (indexed by its original positional index — i.e. `mon_row_id` elsewhere
    in this pipeline), computes a proxy completion date as the LATEST real,
    independently-recorded event date PPDO's own records contain for that
    project: that row's own DATE MONITORED value, or the "Date Submitted" of
    a Liquidation Report Con row the Step 3 crosswalk links to the same
    project (a project_key maps to at most one linked monitoring row and at
    most one linked liquidation row by construction — see
    build_project_crosswalk), whichever is later.

    Returns a Series aligned to `monitoring_raw`'s index; NaT wherever
    neither source yields a usable date (no monitoring visit was ever logged
    and no liquidation record links to this row) — those rows are NOT
    recoverable by this method and remain unresolved.
    """
    mon_dates = pd.to_datetime(monitoring_raw["DATE MONITORED"], errors="coerce")

    liq_dates = pd.to_datetime(liquidation["Date Submitted"], errors="coerce")
    link = crosswalk.dropna(subset=["mon_row_id", "liq_row_id"]).copy()
    link["mon_row_id"] = link["mon_row_id"].astype(int)
    link["liq_row_id"] = link["liq_row_id"].astype(int)
    link["liq_date"] = link["liq_row_id"].map(liq_dates)
    # A mon_row_id could in principle appear more than once in the crosswalk;
    # keep the latest linked liquidation date deterministically (same
    # precedent as the mon_row_id de-duplication in run()).
    liq_date_by_mon_row = link.groupby("mon_row_id")["liq_date"].max()
    liq_aligned = liq_date_by_mon_row.reindex(monitoring_raw.index)
    # Defensive re-cast: when `link` is empty (no crosswalk rows at all, or
    # none surviving the dropna above) or `liq_date_by_mon_row` ends up
    # entirely NaN, some pandas/numpy builds infer liq_aligned as float64
    # rather than datetime64[ns] -- observed in practice on a Windows
    # environment (though not reproduced under Linux/pandas 2.2-2.3 here),
    # most likely from Windows numpy's int32-by-default indexing behavior
    # flowing through .map()/.groupby(). Concatenating a float64 all-NaN
    # column with mon_dates' datetime64[ns] column and calling .max(axis=1)
    # then raises "Cannot cast DatetimeArray to dtype float64" instead of
    # silently returning NaT. Forcing liq_aligned through pd.to_datetime()
    # guarantees datetime64[ns] regardless of how it was inferred.
    liq_aligned = pd.to_datetime(liq_aligned, errors="coerce")

    proxy = pd.concat([mon_dates, liq_aligned], axis=1).max(axis=1)
    return proxy


def _status_matches(status_clean: pd.Series, substrings: list[str]) -> pd.Series:
    normalized = status_clean.astype(str).str.lower()
    mask = pd.Series(False, index=status_clean.index)
    for kw in substrings:
        mask |= normalized.str.contains(kw, regex=False, na=False)
    return mask


def compute_empirical_lag_days(d_end_direct: pd.Series, proxy_dates_all: pd.Series) -> tuple[float, int]:
    """
    Phase 7 empirical lag correction: calibrates how far, on average, the
    Phase 6 proxy date (the latest recorded monitoring visit or liquidation
    submission) trails the TRUE physical completion date.

    Isolates every row that has BOTH a directly-observed 'Date of
    Completion' AND a computable proxy date (i.e. rows where we can check
    the proxy method's date against ground truth), and returns the MEDIAN
    of (proxy_date - direct_date) in days across that calibration set,
    along with the calibration sample size. Median, not mean, is used
    because the lag distribution has a long right tail (a small number of
    projects liquidated years after completion) that would otherwise pull a
    mean-based correction too far.

    A positive median lag means the proxy date is, typically, LATER than
    the true completion date — i.e. paperwork trails physical completion —
    which is what Phase 6 diagnosed from the raw 7.6% vs 82.3% RedFlag-rate
    gap between directly-observed and proxy-recovered rows. This function
    only measures the lag; `construct_target_variable` applies it as a
    subtractive correction to the proxy dates used for the recovered
    (previously-unresolved) subset.
    """
    calibration_mask = d_end_direct.notna() & proxy_dates_all.notna()
    n_calibration = int(calibration_mask.sum())
    if n_calibration == 0:
        logger.warning(
            "Step 6 lag calibration: no rows have both a direct completion date and a "
            "computable proxy date — cannot calibrate; proxy dates will be used uncorrected."
        )
        return 0.0, 0
    lag_days = (proxy_dates_all[calibration_mask] - d_end_direct[calibration_mask]).dt.days
    median_lag = float(lag_days.median())
    logger.info(
        "Step 6 lag calibration: %d rows have both a direct and a proxy date. "
        "Median lag (proxy - direct) = %.1f days (mean %.1f, std %.1f, min %d, max %d).",
        n_calibration, median_lag, float(lag_days.mean()), float(lag_days.std()),
        int(lag_days.min()), int(lag_days.max()),
    )
    return median_lag, n_calibration


def construct_target_variable(
    monitoring: pd.DataFrame, liquidation: pd.DataFrame, crosswalk: pd.DataFrame,
    report: FeatureEngineeringReport,
) -> pd.DataFrame:
    """
    Implements the operational Red Flag / Negative Slippage formula added to
    Chapter 3's "Target Variable Construction" subsection during manuscript
    reconciliation:

        T_actual           = Date of Completion - D_start
        T_standard         = 365 days (Infrastructure) or 182 (Non-Infrastructure)
        RedFlag             = 1 if T_actual > T_standard AND NOT Extension_Approved
        NegativeSlippage%  = (T_actual - T_standard) / T_standard * 100

    D_start falls back to DATE MONITORED when DATE RELEASED is unavailable,
    per Chapter 3. RedFlag/NegativeSlippage_pct are left as NaN (unlabeled)
    whenever either input to the formula is unknown:
      - project_type == 'Unclassified' (no defined T_standard), or
      - no completion date — direct or proxy (see below) — is available.

    D_start (with the DATE MONITORED fallback already applied) and a
    date_released_is_proxy flag are persisted onto the returned dataframe so
    engineer_features() (Step 9) can derive release_month/release_quarter/
    days_since_release/is_wet_season_release from the SAME resolved date
    used here, instead of silently recomputing from the raw, sometimes-
    unparseable DATE RELEASED column. Before this fix, ~1,282 rows with an
    invalid DATE RELEASED (e.g. a bare literal year like "2016" instead of
    an Excel date serial — see preprocess.py's EXCEL_SERIAL_MIN/MAX check)
    got RedFlag computed correctly via the DATE MONITORED fallback, but
    every release-date-derived FEATURE for those same rows was NaN (or, for
    is_wet_season_release, a silently wrong False rather than NaN) — an
    inconsistency between how the target and the features handled the same
    defect, caught via a user question about the raw "2016"-style values
    visible in the source spreadsheet.

    PHASE 3 CORRECTION (preserved): a project without a recorded completion
    date and whose STATUS does not confirm it is finished is ONGOING, not a
    confirmed delay — it never receives a fabricated or "provisional" label.

    PHASE 6 ADDITION (universal proxy-date recovery — see module docstring
    for the full rationale and the raw-data counts that motivated it): when
    'Date  of Completion' is missing, this function now checks STATUS_clean
    before concluding the row is ongoing:
      - STATUS confirms completed/functional (substring match against
        COMPLETED_STATUS_SUBSTRINGS) AND `compute_proxy_completion_dates`
        recovers a real event date that is not earlier than D_start -> that
        date is used as a PROXY completion date, RedFlag is computed from it
        exactly as for a directly-observed date, and
        `completion_date_is_proxy=True` marks the row.
      - STATUS confirms completed/functional but no usable proxy date exists
        (or the only recoverable date precedes D_start, which would imply a
        negative duration and is treated as not credible) -> still
        unresolved; routed to inference.csv, same as Phase 3.
      - STATUS does not confirm completed (On-going, Not Implemented, For
        Bidding, For Implementation, unmapped, or missing STATUS) -> routed
        to inference.csv exactly as under the Phase 3 correction. This
        function never infers "completed" purely from an old Year value or
        from elapsed time — only from what STATUS itself says.
    """
    df = monitoring.copy()

    # PHASE 11 — EXACT-DUPLICATE ROW REMOVAL (DQ-11, 2026-08-15 audit, see
    # D11-Exact-Duplicate-Removal.md): 503 of the full 8,784-row monitoring
    # population share an identical (NAME OF PROJECT, DATE RELEASED, DATE
    # MONITORED, AMOUNT (Php)) fingerprint with another row that has a
    # DIFFERENT mon_row_id -- confirmed genuine duplicate ledger entries (not
    # a crosswalk/join artifact producing repeated rows from a single source
    # record). Dropped here, before D_start/RedFlag are even computed, so it
    # cascades to the full ML pipeline (train/test AND inference.csv) via the
    # existing RedFlag-based partition further down -- not just the labeled
    # split. `keep="first"` is deterministic given a stable input row order.
    # Intentionally does NOT touch `monitoring_raw`/assemble_lstm_sequences's
    # LSTM sequence assembly, which has its own documented, position-fragile
    # dependency on the crosswalk's original row order (see that function's
    # docstring) -- deduping there safely would need separate, more invasive
    # changes and is out of scope for this pass; LSTM sequences still include
    # the duplicate raw events as a known, called-out limitation.
    duplicate_mask = df.duplicated(subset=DUPLICATE_ROW_KEY_COLUMNS, keep="first")
    n_duplicates_dropped = int(duplicate_mask.sum())
    if n_duplicates_dropped:
        logger.warning(
            "PHASE 11: dropping %d exact-duplicate raw monitoring rows (identical "
            "project/dates/amount, distinct source row) out of %d total.",
            n_duplicates_dropped, len(df),
        )
    df = df[~duplicate_mask].copy()

    d_start_direct = pd.to_datetime(df["DATE RELEASED"], errors="coerce")
    d_start_fallback = pd.to_datetime(df["DATE MONITORED"], errors="coerce")
    d_start = d_start_direct.fillna(d_start_fallback)
    date_released_is_proxy = d_start_direct.isna() & d_start.notna()
    df["D_start"] = d_start
    df["date_released_is_proxy"] = date_released_is_proxy

    # PHASE 9 — STUDY-PERIOD FLOOR (DQ-9, 2026-08-15 audit, see
    # D09-Study-Period-Floor.md): 3 labeled rows were found with D_start
    # years (2010, 2010, 2013) that are 8-13 years before every other row in
    # their own monitoring batch (same FILE NAME/Year) -- almost certainly
    # data-entry errors that only survive preprocess.py's deliberately wide
    # 2000-2030 plausibility filter. STUDY_PERIOD_START is set at the DATA's
    # own natural gap (see that constant's comment), not Chapter 1's stated
    # 2016-2025 scope -- a blanket 2016 floor was tried first and rejected
    # for also excluding 381 legitimate 2015 rows with no evidence of error.
    # Dropped here (before Phase 6/7/8 run) rather than just NaN'd, so it
    # cascades to the full pipeline exactly like Phase 11 above, and so every
    # downstream count in this function already reflects the cleaned
    # population.
    pre_study_period_mask = d_start.notna() & (d_start < STUDY_PERIOD_START)
    n_pre_study_period_dropped = int(pre_study_period_mask.sum())
    if n_pre_study_period_dropped:
        logger.warning(
            "PHASE 9: dropping %d rows with D_start before the declared study period "
            "(%s) -- see date_anomaly_review.csv precedent / D09 for evidence.",
            n_pre_study_period_dropped, STUDY_PERIOD_START.date(),
        )
    df = df[~pre_study_period_mask].copy()
    # Resync local Series to the now-filtered df -- everything below must be
    # index-aligned with `df`, not with the original (larger) `monitoring`.
    d_start = df["D_start"]
    date_released_is_proxy = df["date_released_is_proxy"]

    # PHASE 9 diagnostic (non-blocking, log/export only -- see
    # BATCH_YEAR_DEVIATION_THRESHOLD_YEARS): unlike the hard cutoff above,
    # this does not tie back to a manuscript-declared bound and government
    # fund-release-to-monitoring gaps of a few years are not on their own
    # implausible, so nothing is auto-dropped on this signal alone -- it only
    # surfaces candidates in date_anomaly_review.csv for manual review.
    batch_year = pd.to_numeric(df.get("Year", pd.Series(np.nan, index=df.index)), errors="coerce")
    batch_year_deviation = (d_start.dt.year - batch_year).abs()
    batch_year_deviation_flag = (batch_year_deviation > BATCH_YEAR_DEVIATION_THRESHOLD_YEARS).fillna(False)
    df["batch_year_deviation_flag"] = batch_year_deviation_flag
    n_batch_year_deviation_flagged = int(batch_year_deviation_flag.sum())
    if n_batch_year_deviation_flagged:
        logger.info(
            "PHASE 9 diagnostic: %d rows flagged (D_start year deviates >%d years from "
            "their own Year column) -- NOT auto-dropped, written to date_anomaly_review.csv "
            "for manual review.",
            n_batch_year_deviation_flagged, BATCH_YEAR_DEVIATION_THRESHOLD_YEARS,
        )

    d_end_direct = pd.to_datetime(df["Date  of Completion"], errors="coerce")

    status_clean = df.get("STATUS_clean", pd.Series("", index=df.index))
    is_completed_status = _status_matches(status_clean, COMPLETED_STATUS_SUBSTRINGS)
    is_ongoing_status = _status_matches(status_clean, ONGOING_STATUS_SUBSTRINGS)

    missing_direct_date = d_end_direct.isna()
    # NOTE: passes `df` (already filtered by Phase 9/11 above), not the raw
    # `monitoring` parameter -- compute_proxy_completion_dates aligns its
    # result to whatever index it's given via `.reindex(monitoring_raw.index)`
    # (see its docstring), and `df`'s surviving rows keep their ORIGINAL
    # index labels (Phase 9/11 filter via boolean mask, never reset_index()),
    # which still equal their true mon_row_id -- so this stays correctly
    # aligned with the crosswalk-based liquidation-date lookup even after
    # rows have been dropped.
    proxy_dates_raw = compute_proxy_completion_dates(df, liquidation, crosswalk)

    # PHASE 7 EMPIRICAL LAG CORRECTION: the raw proxy date (last recorded
    # monitoring visit or liquidation submission) is a systematically LATE
    # upper bound on true physical completion — Phase 6 surfaced this as an
    # 82.3% vs 7.6% RedFlag-rate gap between proxy-recovered and
    # directly-observed rows. Rather than leave that as a documented but
    # unaddressed bias, calibrate the typical lag from the subset of rows
    # where BOTH a direct date and a proxy date exist, and shift every
    # proxy date back by that median lag before using it as a completion
    # date. This does not touch directly-observed dates at all.
    median_lag_days, n_lag_calibration = compute_empirical_lag_days(d_end_direct, proxy_dates_raw)
    proxy_dates_corrected = proxy_dates_raw - pd.Timedelta(days=median_lag_days)

    # PHASE 8 CLAMP (narrow, evidence-gated — see module docstring): a flat
    # subtraction of the median lag can occasionally push a SHORT-duration
    # project's corrected date back before its own D_start, which is not
    # credible on its face. Diagnosing the ~2,362 rows this affected showed
    # two distinct causes that must NOT be treated the same way:
    #   - "correction overshoot" (n=1,260): the RAW, uncorrected proxy date
    #     (the row's own DATE MONITORED, or linked liquidation submission
    #     date) IS genuinely after D_start — the lag subtraction alone is
    #     what pushes it non-credible. Here the raw evidence supports a real
    #     completion event after D_start; only the correction's fixed
    #     magnitude is the problem, so it is credible to clamp the corrected
    #     date at D_start + 1 day rather than discard the row's real event.
    #   - "raw invalid" (n=1,102): the RAW proxy date is already at or before
    #     D_start, with no correction involved at all — the underlying
    #     monitoring/liquidation record itself implies a nonsensical or
    #     zero/negative-duration timeline (e.g. transposed or mis-keyed
    #     dates). There is no real event here to anchor a clamp to, so these
    #     rows are left unresolved exactly as before — clamping them would
    #     assert a completion date that isn't backed by any actual record.
    #
    # Clamped rows get RedFlag=0 by construction (T_actual=1 day is always
    # far below any T_standard), which is NOT an observed on-time completion
    # — it is an artifact of pinning the date at D_start+1. These rows are
    # marked via `completion_date_is_clamped` so downstream reporting and
    # the methodology writeup can flag their RedFlag/NegativeSlippage_pct as
    # proxy-constructed rather than evidence-based, and a reader can exclude
    # or discount them if a stricter evidentiary standard is needed.
    raw_proxy_after_start = proxy_dates_raw.notna() & d_start.notna() & (proxy_dates_raw > d_start)
    correction_overshoot = (
        missing_direct_date & is_completed_status & raw_proxy_after_start
        & proxy_dates_corrected.notna() & (proxy_dates_corrected <= d_start)
    )
    clamped_date = d_start + pd.Timedelta(days=1)
    proxy_dates_final = proxy_dates_corrected.where(~correction_overshoot, clamped_date)

    # Only a genuinely later event than D_start is a credible proxy for a
    # COMPLETION date; a "recovered" date earlier than or equal to D_start
    # would imply a non-positive project duration, which is not credible and
    # is treated as no-usable-proxy rather than silently accepted. This
    # check is applied to the LAG-CORRECTED (and, for the overshoot subset,
    # clamped) date, since correcting a proxy date can occasionally pull it
    # back before D_start for very short-duration projects — rows whose raw
    # data itself is non-credible correctly fall back to "unresolved" rather
    # than being forced through with an implausible (negative-duration)
    # corrected date.
    proxy_usable = (
        missing_direct_date & is_completed_status & proxy_dates_final.notna()
        & d_start.notna() & (proxy_dates_final > d_start)
    )

    completion_date_is_proxy = proxy_usable
    completion_date_is_clamped = proxy_usable & correction_overshoot
    d_end = d_end_direct.where(~proxy_usable, proxy_dates_final)

    t_standard = df["project_type"].map(STANDARD_DURATION_DAYS)  # NaN for Unclassified
    t_actual = (d_end - d_start).dt.days

    remarks_text = df.get("REMARKS", pd.Series("", index=df.index)).astype(str).str.lower()
    extension_approved = remarks_text.apply(lambda s: any(kw in s for kw in WEATHER_EXTENSION_KEYWORDS))
    n_extension_matches = int(extension_approved.sum())
    logger.warning(
        "Step 6: only %d/%d rows matched a weather/environmental keyword in REMARKS — "
        "REMARKS records liquidation status in this workbook, not delay justification, "
        "so Extension_Approved defaults to False elsewhere. See module docstring.",
        n_extension_matches, len(df),
    )

    has_completion_date = d_end.notna() & d_start.notna()

    red_flag = pd.Series(np.nan, index=df.index)
    valid_direct = has_completion_date & t_standard.notna()
    red_flag.loc[valid_direct] = (
        (t_actual.loc[valid_direct] > t_standard.loc[valid_direct]) & (~extension_approved.loc[valid_direct])
    ).astype(int)

    negative_slippage_pct = pd.Series(np.nan, index=df.index)
    negative_slippage_pct.loc[valid_direct] = (
        (t_actual.loc[valid_direct] - t_standard.loc[valid_direct]) / t_standard.loc[valid_direct] * 100
    ).round(1)

    df["T_actual_days"] = t_actual
    df["T_standard_days"] = t_standard
    df["extension_approved"] = extension_approved
    df["has_completion_date"] = has_completion_date
    df["completion_date_is_proxy"] = completion_date_is_proxy
    df["completion_date_is_clamped"] = completion_date_is_clamped
    df["RedFlag"] = red_flag
    df["NegativeSlippage_pct"] = negative_slippage_pct

    labeled = int(red_flag.notna().sum())
    positive = int((red_flag == 1).sum())
    n_ongoing = int((~has_completion_date).sum())
    n_proxy_recovered = int(completion_date_is_proxy.sum())
    n_proxy_clamped = int(completion_date_is_clamped.sum())
    n_completed_status_unrecovered = int(
        (missing_direct_date & is_completed_status & ~proxy_usable).sum()
    )
    n_genuinely_ongoing = int((missing_direct_date & is_ongoing_status).sum())
    # Phase 7: report the RedFlag rate split by direct vs. (now lag-corrected)
    # proxy-derived rows, so the calibration's effect is visible in every run
    # rather than requiring a separate ad hoc query to see it.
    direct_labeled_mask = valid_direct & ~completion_date_is_proxy
    proxy_labeled_mask = valid_direct & completion_date_is_proxy
    direct_positive_rate = (
        round(float(red_flag[direct_labeled_mask].mean()) * 100, 1) if direct_labeled_mask.any() else None
    )
    proxy_positive_rate = (
        round(float(red_flag[proxy_labeled_mask].mean()) * 100, 1) if proxy_labeled_mask.any() else None
    )

    report.target_construction = {
        "rows_total": len(df),
        "rows_duplicates_dropped_phase11": n_duplicates_dropped,
        "rows_dropped_pre_study_period_phase9": n_pre_study_period_dropped,
        "rows_batch_year_deviation_flagged_phase9_diagnostic": n_batch_year_deviation_flagged,
        "rows_labeled": labeled,
        "rows_labeled_via_proxy_date": n_proxy_recovered,
        "rows_labeled_via_clamped_proxy_date": n_proxy_clamped,
        "rows_date_released_recovered_via_date_monitored": int(date_released_is_proxy.sum()),
        "rows_still_missing_d_start": int(d_start.isna().sum()),
        "rows_ongoing_no_completion_date": n_ongoing,
        "rows_completed_status_but_unrecoverable_date": n_completed_status_unrecovered,
        "rows_genuinely_ongoing_status": n_genuinely_ongoing,
        "rows_unlabeled_unclassified_type": int((df["project_type"] == "Unclassified").sum()),
        "red_flag_positive_rate_pct": round(positive / labeled * 100, 1) if labeled else None,
        "red_flag_positive_rate_direct_only_pct": direct_positive_rate,
        "red_flag_positive_rate_proxy_only_pct": proxy_positive_rate,
        "lag_correction_median_days": median_lag_days,
        "lag_correction_calibration_n": n_lag_calibration,
        "extension_approved_matches": n_extension_matches,
    }
    logger.info(
        "Step 6: labeled %d/%d rows (%s%% RedFlag positive), of which %d recovered via a "
        "Phase 6 proxy completion date (lag-corrected by %.1f median days, calibrated on "
        "%d rows; %d of those via the Phase 8 D_start+1 clamp — RedFlag=0 for these is a "
        "construction artifact, not observed evidence); %d ongoing/unresolved -> routed to "
        "inference (%d STATUS-completed-but-unrecoverable-date, %d genuinely ongoing/other)",
        labeled, len(df), report.target_construction["red_flag_positive_rate_pct"],
        n_proxy_recovered, median_lag_days, n_lag_calibration, n_proxy_clamped,
        n_ongoing, n_completed_status_unrecovered, n_genuinely_ongoing,
    )
    logger.info(
        "Step 6 Phase 7 calibration effect: direct-observed RedFlag rate = %s%% (n=%d) vs. "
        "lag-corrected proxy RedFlag rate = %s%% (n=%d).",
        direct_positive_rate, int(direct_labeled_mask.sum()),
        proxy_positive_rate, int(proxy_labeled_mask.sum()),
    )
    return df


# ==============================================================================
# STEP 7 — Missing-value imputation
# ==============================================================================

def impute_numeric_features(
    df: pd.DataFrame, columns: list[str], report: FeatureEngineeringReport,
) -> pd.DataFrame:
    """
    Apply multiple imputation (scikit-learn's IterativeImputer, a MICE
    implementation) to the given numeric feature columns, per Chapter 3's
    Data Cleaning protocol ("Missing values are handled through multiple
    imputation").

    Deliberately excludes target-derived columns (RedFlag, T_actual_days,
    NegativeSlippage_pct, T_standard_days) from both the input and the
    imputer's fit, even if accidentally passed in `columns` — imputing the
    very quantity used to construct the prediction target would leak target
    information into what should be independent features.
    """
    df = df.copy()
    exclude = {"RedFlag", "T_actual_days", "NegativeSlippage_pct", "T_standard_days"}
    impute_cols = [c for c in columns if c in df.columns and c not in exclude]
    if not impute_cols:
        logger.warning("Step 7: no eligible numeric columns to impute")
        return df

    before_missing = {c: int(df[c].isna().sum()) for c in impute_cols}
    imputer = IterativeImputer(random_state=RANDOM_SEED_DEFAULT, max_iter=15, sample_posterior=False)
    df[impute_cols] = imputer.fit_transform(df[impute_cols])
    after_missing = {c: int(df[c].isna().sum()) for c in impute_cols}

    report.imputation = {"columns": impute_cols, "missing_before": before_missing, "missing_after": after_missing}
    logger.info("Step 7: imputed columns %s (missing before: %s)", impute_cols, before_missing)
    return df


# ==============================================================================
# STEP 8 — Outlier detection
# ==============================================================================

def flag_outliers_iqr_stratified(
    df: pd.DataFrame, amount_col: str, group_col: str, report: FeatureEngineeringReport,
) -> pd.DataFrame:
    """
    Flags (does not drop) outliers in `amount_col` using the IQR method
    applied to log1p-transformed values, computed SEPARATELY within each
    `group_col` stratum (project_type). Per Data Audit Report Finding DQ-6,
    pooling Infrastructure and Non-Infrastructure costs before applying IQR
    over-flags legitimate high-cost infrastructure projects (12.9% flagged
    in the v1 pooled/raw-scale pass).
    """
    df = df.copy()
    log_amount = np.log1p(df[amount_col].clip(lower=0))
    df["_log_amount"] = log_amount
    df["amount_outlier_flag"] = False

    stats = {}
    for group_value, group_df in df.groupby(group_col):
        values = group_df["_log_amount"].dropna()
        if len(values) < 10:
            continue  # too few observations in this stratum for a meaningful IQR
        q1, q3 = values.quantile(0.25), values.quantile(0.75)
        iqr = q3 - q1
        lo, hi = q1 - 1.5 * iqr, q3 + 1.5 * iqr
        mask = (df[group_col] == group_value) & ((df["_log_amount"] < lo) | (df["_log_amount"] > hi))
        df.loc[mask, "amount_outlier_flag"] = True
        stats[str(group_value)] = {
            "n": int(len(values)), "outliers": int(mask.sum()),
            "outlier_pct": round(float(mask.sum()) / len(values) * 100, 1) if len(values) else 0.0,
        }

    df.drop(columns=["_log_amount"], inplace=True)
    report.outliers = stats
    logger.info("Step 8: outlier flags by %s: %s", group_col, stats)
    return df


# ==============================================================================
# STEP 9 — Feature engineering
# ==============================================================================

def engineer_features(
    df: pd.DataFrame, contractors: Optional[pd.DataFrame], report: FeatureEngineeringReport,
) -> pd.DataFrame:
    """
    One-hot encodes normalized categoricals, extracts temporal features from
    the project's start date, and (if available) joins the synthetic
    contractor table — per Chapter 3's Feature Engineering protocol.

    Uses D_start (DATE RELEASED, falling back to DATE MONITORED — the same
    resolved date construct_target_variable() already computes for RedFlag)
    rather than recomputing straight from the raw, sometimes-unparseable
    DATE RELEASED column, if D_start is present on `df` (Step 6 always runs
    before this in `run()`). This fixes a prior inconsistency where ~1,282
    rows with an invalid DATE RELEASED (e.g. a bare literal year like "2016"
    instead of an Excel serial date) got a correct RedFlag label via the
    DATE MONITORED fallback, but NaN release-date features regardless.
    """
    df = df.copy()
    if "D_start" in df.columns:
        released = pd.to_datetime(df["D_start"], errors="coerce")
    else:
        # Fallback for callers that invoke this function directly without
        # construct_target_variable() having run first (e.g. isolated tests).
        released = pd.to_datetime(df["DATE RELEASED"], errors="coerce")

    df["release_month"] = released.dt.month
    df["release_quarter"] = released.dt.quarter
    df["days_since_release"] = (DATASET_HORIZON - released).dt.days
    # Philippine wet season is approximately June-November; this is a coarse
    # proxy pending real PAGASA integration (Data Audit Report, Section 5) —
    # NOT an actual weather observation. Rows where `released` itself is
    # unresolvable (no DATE RELEASED and no DATE MONITORED — a small
    # residual population; see report.target_construction's
    # rows_still_missing_d_start) get NaN here, not a silently wrong False:
    # a project with genuinely unknown release timing is not the same claim
    # as "confirmed released outside wet season."
    is_wet = released.dt.month.isin([6, 7, 8, 9, 10, 11]).astype(float)
    is_wet[released.isna()] = np.nan
    df["is_wet_season_release"] = is_wet

    df["municipality_canonical"] = df["LOCATION"].astype(str).map(
        lambda s: canonicalize_municipality(s.split(",")[-1])
    )

    categorical_cols = [c for c in ["STATUS_clean", "project_type", "municipality_canonical"] if c in df.columns]
    df = pd.get_dummies(df, columns=categorical_cols, prefix=categorical_cols, dummy_na=False)

    if contractors is not None and "contractor_id" in df.columns:
        join_cols = ["contractor_id", "historical_delay_rate", "reliability_score", "specialization"]
        df = df.merge(contractors[join_cols], on="contractor_id", how="left")
        df = pd.get_dummies(df, columns=["specialization"], prefix="contractor_spec", dummy_na=True)
        logger.info("Step 9: joined synthetic contractor features on contractor_id")
    else:
        logger.warning("Step 9: no contractor table provided/joinable — skipping contractor feature join")

    logger.info("Step 9: engineered feature set -> %d columns total", df.shape[1])
    return df


# ==============================================================================
# STEP 10 — Sequence assembly for LSTM
# ==============================================================================

def assemble_lstm_sequences(
    monitoring: pd.DataFrame, fund_transfer: pd.DataFrame, liquidation: pd.DataFrame,
    crosswalk: pd.DataFrame, report: FeatureEngineeringReport,
    max_seq_len: int = MAX_LSTM_SEQUENCE_LENGTH,
) -> tuple[np.ndarray, np.ndarray, list[str]]:
    """
    Pivots the three transactional sheets into a per-project, per-period
    panel using the Step 3 crosswalk, per Chapter 3's LSTM input spec. Each
    lifecycle event (fund release, liquidation, field-monitoring visit) is
    represented as [event_type, days_since_first_event, amount]; events are
    sorted chronologically and truncated/padded to `max_seq_len`.

    IMPORTANT: this function must receive the RAW sheets in the same row
    order used when the crosswalk was built in Step 3 (i.e. before any
    row-reordering one-hot encoding or filtering in Steps 6-9) — the
    crosswalk's ft_row_id/liq_row_id/mon_row_id are positional indices into
    that original order.

    Returns (sequences, mask, project_keys):
        sequences    float32 array, shape (n_projects, max_seq_len, 3)
        mask         bool array,    shape (n_projects, max_seq_len) — True
                     where a real (non-padding) event is present
        project_keys list of project_key strings, aligned with axis 0

    ZERO-EVENT PROJECTS (fixed from a prior version that silently dropped
    them): a project with no recorded fund-transfer, liquidation, or
    monitoring-visit event used to be skipped entirely via `continue` --
    which meant it never received an LSTM OOF/test prediction, and
    train_meta_learner.py could only train and evaluate on the (much
    smaller) subset of projects with a matching LSTM row, discarding the
    majority of tabular-scored projects at the meta-learner stage. Every
    project in the crosswalk now gets an entry: a genuinely-empty event
    history becomes an all-padding sequence (identical to the padding used
    for real sequences shorter than max_seq_len) with an all-False mask.
    Keras's Masking(mask_value=-1.0) layer, given a fully-masked sample,
    skips every timestep and the LSTM's output for that sample is its zero
    initial state -- a real, well-defined value (not NaN or an error), and
    a genuinely different signal from any sample with real event history.
    This is tracked separately in `report.sequence_assembly` (
    n_projects_zero_event) rather than silently folded into
    "coverage_pct", so "every project gets a row" is not confused with
    "every project has real history".
    """
    ft_date = pd.to_datetime(fund_transfer["Date"], errors="coerce")
    ft_amount = pd.to_numeric(fund_transfer["Amount"], errors="coerce")
    liq_date = pd.to_datetime(liquidation["Date Submitted"], errors="coerce")
    liq_amount = pd.to_numeric(liquidation["Amount Released (Php)"], errors="coerce")
    # DATE MONITORED (the field-visit date) is used here, not DATE RELEASED —
    # the latter duplicates the fund-release event fund_transfer already
    # supplies and would collapse two distinct lifecycle stages into one.
    mon_date = pd.to_datetime(monitoring["DATE MONITORED"], errors="coerce")
    mon_amount = pd.to_numeric(monitoring["AMOUNT (Php)"], errors="coerce")

    n_features = 3
    sequences, masks, project_keys = [], [], []
    n_zero_event = 0

    for _, row in crosswalk.iterrows():
        events = []

        ft_idx = row.get("ft_row_id")
        if pd.notna(ft_idx) and int(ft_idx) in ft_date.index and pd.notna(ft_date.at[int(ft_idx)]):
            i = int(ft_idx)
            events.append((ft_date.at[i], 0, float(ft_amount.at[i]) if pd.notna(ft_amount.at[i]) else 0.0))

        liq_idx = row.get("liq_row_id")
        if pd.notna(liq_idx) and int(liq_idx) in liq_date.index and pd.notna(liq_date.at[int(liq_idx)]):
            i = int(liq_idx)
            events.append((liq_date.at[i], 1, float(liq_amount.at[i]) if pd.notna(liq_amount.at[i]) else 0.0))

        mon_idx = row.get("mon_row_id")
        if pd.notna(mon_idx) and int(mon_idx) in mon_date.index and pd.notna(mon_date.at[int(mon_idx)]):
            i = int(mon_idx)
            events.append((mon_date.at[i], 2, float(mon_amount.at[i]) if pd.notna(mon_amount.at[i]) else 0.0))

        # Padding is filled with -1, not 0: event_type=0 is a legitimate value
        # (a fund-release event), so padding with zeros would be indistinguishable
        # from a real release event at day 0 with amount 0 to a Keras
        # Masking(mask_value=...) layer. -1 never occurs in real data (event
        # types are 0/1/2, days-since-anchor and amount are both >= 0), so it's
        # an unambiguous padding sentinel for train_lstm.py.
        seq = np.full((max_seq_len, n_features), -1.0, dtype=np.float32)
        mask = np.zeros(max_seq_len, dtype=bool)

        if not events:
            # No real event history for this project -- emit the all-padding
            # sequence built above as-is (all-False mask) rather than
            # dropping the project. See this function's docstring.
            n_zero_event += 1
        else:
            events.sort(key=lambda e: e[0])
            anchor_date = events[0][0]
            for step_i, (event_date, event_type, amount) in enumerate(events[:max_seq_len]):
                seq[step_i] = [event_type, float((event_date - anchor_date).days), amount]
                mask[step_i] = True

        sequences.append(seq)
        masks.append(mask)
        project_keys.append(row["project_key"])

    sequences_arr = np.stack(sequences) if sequences else np.zeros((0, max_seq_len, n_features), dtype=np.float32)
    masks_arr = np.stack(masks) if masks else np.zeros((0, max_seq_len), dtype=bool)

    n_with_real_events = len(project_keys) - n_zero_event
    report.sequence_assembly = {
        "n_projects_with_sequence": len(project_keys),
        "n_projects_total_in_crosswalk": len(crosswalk),
        "coverage_pct": round(len(project_keys) / len(crosswalk) * 100, 1) if len(crosswalk) else 0.0,
        "n_projects_with_real_events": n_with_real_events,
        "n_projects_zero_event": n_zero_event,
        "real_event_pct": round(n_with_real_events / len(crosswalk) * 100, 1) if len(crosswalk) else 0.0,
        "max_seq_len": max_seq_len,
        "n_features_per_step": n_features,
    }
    logger.info(
        "Step 10: assembled %d/%d project sequences (100%% coverage -- every crosswalk project now "
        "gets a row); %d (%.1f%%) have real event history, %d get an all-padding placeholder for "
        "genuinely empty history (see assemble_lstm_sequences docstring)",
        len(project_keys), len(crosswalk), n_with_real_events,
        report.sequence_assembly["real_event_pct"], n_zero_event,
    )
    return sequences_arr, masks_arr, project_keys


# ==============================================================================
# STEP 11 — Normalization & project-level train/test split
# ==============================================================================

def normalize_and_split(
    df: pd.DataFrame, target_col: str, project_key_col: str,
    numeric_cols: list[str], report: FeatureEngineeringReport,
    test_size: float = 0.3, seed: int = RANDOM_SEED_DEFAULT,
) -> tuple[pd.DataFrame, pd.DataFrame, dict]:
    """
    Applies min-max normalization (fit on the train split only, to avoid
    train/test leakage) and performs a project-level 70/30 train/test split:
    splitting is done on unique `project_key_col` values, not individual
    rows, so a single project's multiple monitoring visits cannot appear on
    both sides of the split (Chapter 3, Model Evaluation).
    """
    rng = np.random.default_rng(seed)
    unique_projects = df[project_key_col].dropna().unique()
    rng.shuffle(unique_projects)
    n_test = int(len(unique_projects) * test_size)
    test_projects = set(unique_projects[:n_test])
    train_projects = set(unique_projects[n_test:])

    train_df = df[df[project_key_col].isin(train_projects)].copy()
    test_df = df[df[project_key_col].isin(test_projects)].copy()

    scale_cols = [c for c in numeric_cols if c in df.columns]
    scaler_params: dict = {}
    for col in scale_cols:
        col_min, col_max = train_df[col].min(), train_df[col].max()
        col_min = float(col_min) if pd.notna(col_min) else 0.0
        col_max = float(col_max) if pd.notna(col_max) else 1.0
        scaler_params[col] = {"min": col_min, "max": col_max}
        denom = (col_max - col_min) or 1.0
        train_df[col] = ((train_df[col] - col_min) / denom).clip(0, 1)
        test_df[col] = ((test_df[col] - col_min) / denom).clip(0, 1)

    report.split = {
        "n_projects_train": len(train_projects), "n_projects_test": len(test_projects),
        "n_rows_train": len(train_df), "n_rows_test": len(test_df),
        "scaled_columns": scale_cols,
    }
    if target_col in df.columns:
        report.split["labeled_rows_train"] = int(train_df[target_col].notna().sum())
        report.split["labeled_rows_test"] = int(test_df[target_col].notna().sum())

    logger.info(
        "Step 11: split into %d train / %d test projects (%d / %d rows)",
        len(train_projects), len(test_projects), len(train_df), len(test_df),
    )
    return train_df, test_df, scaler_params


def apply_scaler(df: pd.DataFrame, scaler_params: dict) -> pd.DataFrame:
    """
    Applies min-max scaling fitted on the labeled TRAIN split (via
    `normalize_and_split`) to another dataframe — specifically, the ongoing/
    inference rows. Values are transformed, never re-fit, so the inference
    set cannot leak into the scaling parameters; values outside the training
    range are clipped to [0, 1] (i.e. treated as at-the-boundary), which is
    the expected, defensible behavior when scoring newer data than the model
    was trained on.
    """
    df = df.copy()
    for col, params in scaler_params.items():
        if col not in df.columns:
            continue
        denom = (params["max"] - params["min"]) or 1.0
        df[col] = ((df[col] - params["min"]) / denom).clip(0, 1)
    return df


# ==============================================================================
# Orchestration
# ==============================================================================

def run(
    monitoring_input: Path, fund_transfer_input: Path, liquidation_input: Path,
    crosswalk_input: Path, output_dir: Path, contractors_input: Optional[Path] = None,
    seed: int = RANDOM_SEED_DEFAULT,
) -> FeatureEngineeringReport:
    report = FeatureEngineeringReport()
    output_dir.mkdir(parents=True, exist_ok=True)

    for p in (monitoring_input, fund_transfer_input, liquidation_input, crosswalk_input):
        if not p.exists():
            raise FileNotFoundError(f"Required input not found: {p}")

    monitoring_raw = pd.read_csv(monitoring_input)
    # mon_row_id is assigned HERE, immediately on load and before any row could
    # ever be dropped by a future filtering step, because assemble_lstm_sequences()
    # and project_crosswalk.csv both treat it as a POSITIONAL index into this
    # exact row order (see assemble_lstm_sequences docstring). Adding a column
    # does not change row order/count, so this is safe for that requirement;
    # deriving mon_row_id later via reset_index() (as this used to do, right
    # before the project_key join) is NOT safe once an earlier step can drop
    # rows, since every row after the first drop would then get a mon_row_id
    # that no longer matches the crosswalk's actual positional key. mon_row_id
    # is carried as an ordinary column from here on, so it survives any later
    # boolean-mask filtering correctly. This is a latent-bug fix on its own
    # (no prior step ever dropped rows, so it was harmless until now) and a
    # required prerequisite for any future filtering step in this pipeline.
    monitoring_raw = monitoring_raw.reset_index().rename(columns={"index": "mon_row_id"})
    fund_transfer = pd.read_csv(fund_transfer_input)
    liquidation = pd.read_csv(liquidation_input)
    crosswalk = pd.read_csv(crosswalk_input)

    contractors = None
    if contractors_input is not None:
        if contractors_input.exists():
            contractors = pd.read_csv(contractors_input)
        else:
            logger.warning("Contractors input %s not found — proceeding without contractor features", contractors_input)

    # Step 10 runs FIRST and against the untouched, original-row-order sheets
    # (see assemble_lstm_sequences docstring for why row order matters here).
    # This produces ONE combined set of sequences; it is partitioned into
    # labeled vs. ongoing/inference further down, once Step 6 has determined
    # which monitoring rows have a confirmed outcome.
    sequences, seq_mask, seq_project_keys = assemble_lstm_sequences(
        monitoring_raw, fund_transfer, liquidation, crosswalk, report
    )

    monitoring = construct_target_variable(monitoring_raw, liquidation, crosswalk, report)  # Step 6
    monitoring = impute_numeric_features(monitoring, ["AMOUNT (Php)", "Year"], report)    # Step 7
    monitoring = flag_outliers_iqr_stratified(monitoring, "AMOUNT (Php)", "project_type", report)  # Step 8
    monitoring = engineer_features(monitoring, contractors, report)                       # Step 9

    # Attach a project_key to every monitoring row (via the crosswalk's
    # mon_row_id) so the tabular RF/XGBoost split can also be done at the
    # project level, consistent with the LSTM sequence split. Rows with no
    # crosswalk link get a unique per-row fallback key rather than being
    # dropped from the split. mon_row_id is already a column by this point
    # (assigned at monitoring_raw load time, above) -- it must NOT be
    # re-derived via reset_index() here, since a future filtering step
    # inside construct_target_variable() may have already dropped rows; a
    # fresh reset_index() at this point would silently desync from the
    # crosswalk's actual positional keys for every row after the first drop.
    # A single mon_row_id can appear more than once in the crosswalk (e.g. two
    # fuzzy-matched fund-transfer records both linking to the same monitored
    # project); keep the first project_key deterministically rather than
    # erroring on the resulting non-unique index.
    mon_to_project_key = (
        crosswalk.dropna(subset=["mon_row_id"])
        .assign(mon_row_id=lambda d: d["mon_row_id"].astype(int))
        .drop_duplicates(subset="mon_row_id", keep="first")
        .set_index("mon_row_id")["project_key"]
    )
    monitoring["project_key"] = monitoring["mon_row_id"].map(mon_to_project_key)
    monitoring["project_key"] = monitoring["project_key"].fillna(
        "MON_ONLY_" + monitoring["mon_row_id"].astype(str)
    )

    # --- Partition: resolved (has a real RedFlag label) vs. ongoing/inference ---
    # RedFlag is NaN exactly when the row lacks either a completion date or a
    # known project type (Step 6) — i.e. there is no confirmed outcome to
    # train on. These rows are NOT dropped: they are exactly the population
    # the dashboard needs to score, so they get the same Step 7-9 feature
    # engineering as everything else and are written to inference.csv.
    resolved_df = monitoring[monitoring["RedFlag"].notna()].copy()
    inference_df = monitoring[monitoring["RedFlag"].isna()].copy()
    logger.info(
        "Partitioned %d resolved rows (-> train/test) and %d ongoing/unresolved rows (-> inference.csv)",
        len(resolved_df), len(inference_df),
    )

    numeric_cols_to_scale = ["AMOUNT (Php)", "days_since_release", "NegativeSlippage_pct"]
    train_df, test_df, scaler_params = normalize_and_split(              # Step 11
        resolved_df, target_col="RedFlag", project_key_col="project_key",
        numeric_cols=numeric_cols_to_scale, report=report, seed=seed,
    )
    # Inference rows are transformed (never fit) using the train-fitted
    # scaler, so they can be scored with the exact same feature scale the
    # model was trained on without contributing to how that scale was chosen.
    inference_df = apply_scaler(inference_df, scaler_params)

    train_df.to_csv(output_dir / "train.csv", index=False)
    test_df.to_csv(output_dir / "test.csv", index=False)
    inference_df.to_csv(output_dir / "inference.csv", index=False)
    with open(output_dir / "scaler_params.json", "w") as f:
        json.dump(scaler_params, f, indent=2)

    # PHASE 9 diagnostic export: rows NOT auto-dropped by the hard
    # study-period cutoff, but whose D_start still deviates suspiciously from
    # their own monitoring batch's Year column (see construct_target_variable
    # PHASE 9 docstring / D09-Study-Period-Floor.md). Manual-review-only.
    review_cols = [
        c for c in ["mon_row_id", "project_key", "NAME OF PROJECT", "D_start", "Year",
                    "FILE NAME", "DATE RELEASED", "DATE MONITORED"]
        if c in monitoring.columns
    ]
    date_anomaly_review = monitoring.loc[monitoring["batch_year_deviation_flag"], review_cols]
    date_anomaly_review.to_csv(output_dir / "date_anomaly_review.csv", index=False)
    logger.info(
        "Phase 9 diagnostic: wrote %d rows to date_anomaly_review.csv for manual review.",
        len(date_anomaly_review),
    )

    # --- Partition the LSTM sequences the same way, by project_key membership ---
    resolved_keys = set(resolved_df["project_key"])
    seq_is_resolved = np.array([k in resolved_keys for k in seq_project_keys], dtype=bool)

    def _select(arr_seq, arr_mask, keys, sel_mask):
        idx = np.where(sel_mask)[0]
        sel_keys = [keys[i] for i in idx]
        return arr_seq[idx], arr_mask[idx], sel_keys

    train_test_seq, train_test_mask, train_test_keys = _select(sequences, seq_mask, seq_project_keys, seq_is_resolved)
    inference_seq, inference_mask, inference_keys = _select(sequences, seq_mask, seq_project_keys, ~seq_is_resolved)

    np.save(output_dir / "lstm_sequences.npy", train_test_seq)
    np.save(output_dir / "lstm_sequence_mask.npy", train_test_mask)
    with open(output_dir / "lstm_project_keys.json", "w") as f:
        json.dump(train_test_keys, f)

    np.save(output_dir / "lstm_inference_sequences.npy", inference_seq)
    np.save(output_dir / "lstm_inference_sequence_mask.npy", inference_mask)
    with open(output_dir / "lstm_inference_project_keys.json", "w") as f:
        json.dump(inference_keys, f)

    report.sequence_assembly["n_sequences_labeled"] = int(seq_is_resolved.sum())
    report.sequence_assembly["n_sequences_inference"] = int((~seq_is_resolved).sum())
    logger.info(
        "LSTM sequences split: %d labeled (train/test) / %d ongoing (inference)",
        report.sequence_assembly["n_sequences_labeled"], report.sequence_assembly["n_sequences_inference"],
    )

    logger.info("Artifacts written to %s", output_dir.resolve())
    report.log_summary()
    return report


def parse_args(argv: Optional[list[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="MAAGAP feature engineering pipeline (Steps 6-11).")
    parser.add_argument("--monitoring-input", type=Path, required=True)
    parser.add_argument("--fund-transfer-input", type=Path, required=True)
    parser.add_argument("--liquidation-input", type=Path, required=True)
    parser.add_argument("--crosswalk-input", type=Path, required=True)
    parser.add_argument("--contractors-input", type=Path, default=None)
    parser.add_argument("--output-dir", type=Path, default=Path("data/ready"))
    parser.add_argument("--seed", type=int, default=RANDOM_SEED_DEFAULT)
    parser.add_argument("--log-level", type=str, default="INFO", choices=["DEBUG", "INFO", "WARNING", "ERROR"])
    return parser.parse_args(argv)


def main(argv: Optional[list[str]] = None) -> int:
    args = parse_args(argv)
    configure_logging(args.log_level)
    try:
        run(
            args.monitoring_input, args.fund_transfer_input, args.liquidation_input,
            args.crosswalk_input, args.output_dir, args.contractors_input, args.seed,
        )
    except (FileNotFoundError, ValueError) as exc:
        logger.error("Aborted: %s", exc)
        return 1
    except Exception:
        logger.exception("Feature engineering pipeline failed with an unexpected error.")
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
