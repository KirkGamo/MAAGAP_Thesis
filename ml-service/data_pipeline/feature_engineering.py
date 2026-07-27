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

BUSINESS LOGIC CORRECTION: a row missing 'Date  of Completion' is NOT treated
as missing data to be resolved or guessed at. It means the project has not
finished yet — it is ONGOING. Such rows never receive a RedFlag label (there
is no outcome to label), are never imputed or backfilled, and are routed to
data/ready/inference.csv (+ lstm_inference_sequences.npy) instead of
train.csv/test.csv. This is the live population the MAAGAP dashboard scores;
mixing a fabricated outcome into training data for a project still in
progress would be target leakage in the most literal sense.

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

def construct_target_variable(monitoring: pd.DataFrame, report: FeatureEngineeringReport) -> pd.DataFrame:
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
      - Date of Completion is missing.

    BUSINESS LOGIC CORRECTION: an earlier version of this function treated a
    missing completion date as right-censored and provisionally assigned
    RedFlag=1 whenever the project's elapsed time already exceeded
    T_standard and STATUS suggested it wasn't finished. That has been
    removed. A project without a recorded completion date is ONGOING, not a
    confirmed delay — assigning it a label (even a "provisional" one) manufactures
    an outcome that has not actually happened. `has_completion_date` is
    exposed below purely as a routing flag: `run()` uses
    RedFlag.notna() to send unlabeled rows to data/ready/inference.csv rather
    than train.csv/test.csv, where they can be scored by the trained model
    without ever having contributed a fabricated label to it.
    """
    df = monitoring.copy()
    d_start = pd.to_datetime(df["DATE RELEASED"], errors="coerce")
    d_start_fallback = pd.to_datetime(df["DATE MONITORED"], errors="coerce")
    d_start = d_start.fillna(d_start_fallback)
    d_end = pd.to_datetime(df["Date  of Completion"], errors="coerce")

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
    df["RedFlag"] = red_flag
    df["NegativeSlippage_pct"] = negative_slippage_pct

    labeled = int(red_flag.notna().sum())
    positive = int((red_flag == 1).sum())
    n_ongoing = int((~has_completion_date).sum())
    report.target_construction = {
        "rows_total": len(df),
        "rows_labeled": labeled,
        "rows_ongoing_no_completion_date": n_ongoing,
        "rows_unlabeled_unclassified_type": int((df["project_type"] == "Unclassified").sum()),
        "red_flag_positive_rate_pct": round(positive / labeled * 100, 1) if labeled else None,
        "extension_approved_matches": n_extension_matches,
    }
    logger.info(
        "Step 6: labeled %d/%d rows (%s%% RedFlag positive); %d ongoing (no completion date) -> "
        "routed to inference, not train/test",
        labeled, len(df), report.target_construction["red_flag_positive_rate_pct"], n_ongoing,
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
    DATE RELEASED, and (if available) joins the synthetic contractor table —
    per Chapter 3's Feature Engineering protocol.
    """
    df = df.copy()
    released = pd.to_datetime(df["DATE RELEASED"], errors="coerce")

    df["release_month"] = released.dt.month
    df["release_quarter"] = released.dt.quarter
    df["days_since_release"] = (DATASET_HORIZON - released).dt.days
    # Philippine wet season is approximately June-November; this is a coarse
    # proxy pending real PAGASA integration (Data Audit Report, Section 5) —
    # NOT an actual weather observation.
    df["is_wet_season_release"] = released.dt.month.isin([6, 7, 8, 9, 10, 11])

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

        if not events:
            continue

        events.sort(key=lambda e: e[0])
        anchor_date = events[0][0]
        # Padding is filled with -1, not 0: event_type=0 is a legitimate value
        # (a fund-release event), so padding with zeros would be indistinguishable
        # from a real release event at day 0 with amount 0 to a Keras
        # Masking(mask_value=...) layer. -1 never occurs in real data (event
        # types are 0/1/2, days-since-anchor and amount are both >= 0), so it's
        # an unambiguous padding sentinel for train_lstm.py.
        seq = np.full((max_seq_len, n_features), -1.0, dtype=np.float32)
        mask = np.zeros(max_seq_len, dtype=bool)
        for step_i, (event_date, event_type, amount) in enumerate(events[:max_seq_len]):
            seq[step_i] = [event_type, float((event_date - anchor_date).days), amount]
            mask[step_i] = True

        sequences.append(seq)
        masks.append(mask)
        project_keys.append(row["project_key"])

    sequences_arr = np.stack(sequences) if sequences else np.zeros((0, max_seq_len, n_features), dtype=np.float32)
    masks_arr = np.stack(masks) if masks else np.zeros((0, max_seq_len), dtype=bool)

    report.sequence_assembly = {
        "n_projects_with_sequence": len(project_keys),
        "n_projects_total_in_crosswalk": len(crosswalk),
        "coverage_pct": round(len(project_keys) / len(crosswalk) * 100, 1) if len(crosswalk) else 0.0,
        "max_seq_len": max_seq_len,
        "n_features_per_step": n_features,
    }
    logger.info(
        "Step 10: assembled %d/%d project sequences (%.1f%% coverage)",
        len(project_keys), len(crosswalk), report.sequence_assembly["coverage_pct"],
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

    monitoring = construct_target_variable(monitoring_raw, report)                       # Step 6
    monitoring = impute_numeric_features(monitoring, ["AMOUNT (Php)", "Year"], report)    # Step 7
    monitoring = flag_outliers_iqr_stratified(monitoring, "AMOUNT (Php)", "project_type", report)  # Step 8
    monitoring = engineer_features(monitoring, contractors, report)                       # Step 9

    # Attach a project_key to every monitoring row (via the crosswalk's
    # mon_row_id) so the tabular RF/XGBoost split can also be done at the
    # project level, consistent with the LSTM sequence split. Rows with no
    # crosswalk link get a unique per-row fallback key rather than being
    # dropped from the split.
    monitoring = monitoring.reset_index().rename(columns={"index": "mon_row_id"})
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
