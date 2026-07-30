"""
MAAGAP — SHAP-Based Per-Project Risk Explanations
================================================================================
Chapter 3 (and the thesis's fourth objective) commits to SHAP (SHapley
Additive exPlanations) for per-prediction interpretability. This module is
that commitment, scoped honestly to what this specific pipeline can actually
support -- read the scope note below before extending it.

SCOPE — WHAT THIS DOES AND DOES NOT EXPLAIN
------------------------------------------------------------------------------
The Level 0 stack has three base learners feeding a Level 1 multinomial
logistic regression meta-learner (see train_meta_learner.py): Random Forest,
XGBoost, and an LSTM. This module explains only the two TREE-BASED base
learners (Random Forest, XGBoost) via `shap.TreeExplainer`, which is exact,
fast, and has first-class support for both model families. It deliberately
does NOT attempt to SHAP-explain the LSTM: its input is a short event
sequence (event_type, days_since_anchor, amount) rather than semantically
rich per-project features, and SHAP's deep-learning explainers
(DeepExplainer/GradientExplainer) are known to interact poorly with Keras's
Masking layer and TF2 eager execution. Claiming a SHAP value for a sequence
model here would overstate what this pipeline reliably produces.

Both explainers are built with `model_output="probability"` and a shared
background sample (drawn from the TRAIN split's exact feature schema), so
Random Forest's and XGBoost's contributions are in the same unit (additive
pushes on a 0-1 probability scale) before being averaged together — mixing
Random Forest's raw/probability-space output with XGBoost's default
margin/log-odds-space output would silently combine two different units,
which would not be mathematically sound. The returned per-feature value is
the SIMPLE MEAN of the two base learners' SHAP contributions to their own
P(RedFlag) output — an honest, explicitly-labeled approximation of "how much
this feature pushed the ensemble's tree-based half toward or away from a red
flag," not a formal decomposition of the full three-model stack's final
meta-probability (composing SHAP exactly through a nonlinear multi-model
stack is a materially harder, unsolved-in-general problem; this module does
not claim to solve it).
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Optional

import numpy as np
import pandas as pd

logger = logging.getLogger("maagap.explain")

THIS_DIR = Path(__file__).resolve().parent
ML_SERVICE_DIR = THIS_DIR.parent
REPO_ROOT = ML_SERVICE_DIR.parent
DATA_READY_DIR = REPO_ROOT / "data" / "ready"

BACKGROUND_SAMPLE_SIZE = 100
BACKGROUND_SEED = 42
TOP_N_FEATURES = 8

_background_cache: Optional[pd.DataFrame] = None


def _load_background_sample(kept_columns: list[str]) -> pd.DataFrame:
    """A fixed-size, fixed-seed sample of the TRAIN split's feature matrix,
    reindexed to the exact frozen inference-time column schema
    (tabular_feature_columns.json) -- required by SHAP's `model_output=
    "probability"` interventional mode, which perturbs each explained row
    against a reference distribution of "plausible" feature values rather
    than a single fixed baseline. Cached at module level (this ml-service
    process is long-running) so repeated calls across a batch don't re-read
    and re-sample train.csv every time."""
    global _background_cache
    if _background_cache is not None:
        return _background_cache

    import sys
    sys.path.insert(0, str(ML_SERVICE_DIR / "models"))
    from train_trees import build_feature_matrix  # noqa: E402

    train_path = DATA_READY_DIR / "train.csv"
    if not train_path.exists():
        raise FileNotFoundError(f"{train_path} not found — has feature_engineering.py been run?")

    train_df = pd.read_csv(train_path, low_memory=False)
    X_train, _ = build_feature_matrix(train_df, keep_columns=kept_columns)
    sample_size = min(BACKGROUND_SAMPLE_SIZE, len(X_train))
    _background_cache = X_train.sample(n=sample_size, random_state=BACKGROUND_SEED)
    logger.info("Loaded a %d-row SHAP background sample from %s", sample_size, train_path)
    return _background_cache


def _extract_positive_class(shap_output) -> np.ndarray:
    """shap.TreeExplainer's return shape for a binary classifier varies by
    shap version and `model_output` setting -- sometimes a list of two
    (n_samples, n_features) arrays (one per class), sometimes a single array
    already representing the positive class (common under
    `model_output="probability"`, since P(class 1) = 1 - P(class 0) makes a
    second array redundant). Normalize both cases to a single
    (n_samples, n_features) array of contributions to P(RedFlag=1)."""
    if isinstance(shap_output, list):
        return np.asarray(shap_output[-1])
    arr = np.asarray(shap_output)
    # Some shap versions return (n_samples, n_features, n_classes) for
    # binary classifiers even outside a list -- take the last class slice.
    if arr.ndim == 3:
        return arr[:, :, -1]
    return arr


def compute_shap_contributions(
    rf, xgb, X: pd.DataFrame, kept_columns: list[str],
) -> np.ndarray:
    """Returns a (n_samples, n_features) array: the mean of Random Forest's
    and XGBoost's SHAP contributions to their own P(RedFlag) output, both in
    probability-space units (see module docstring)."""
    import shap

    background = _load_background_sample(kept_columns)

    explainer_rf = shap.TreeExplainer(rf, data=background, model_output="probability")
    explainer_xgb = shap.TreeExplainer(xgb, data=background, model_output="probability")

    shap_rf = _extract_positive_class(explainer_rf.shap_values(X))
    shap_xgb = _extract_positive_class(explainer_xgb.shap_values(X))

    return (shap_rf + shap_xgb) / 2.0


def humanize_feature_name(column: str) -> str:
    """Best-effort, human-readable label for a raw engineered-feature column
    name -- e.g. `municipality_canonical_Iloilo City` -> "Municipality:
    Iloilo City". Falls back to a plain title-cased rendering for anything
    not covered by a known prefix. Deliberately does NOT attempt to clean up
    messy source-data category labels beyond this (see
    feature_engineering.py's own caveats about STATUS/municipality label
    quality) -- that's a data-quality issue, not something to paper over in
    a display label."""
    prefix_labels = {
        "STATUS_clean_": "Status",
        "municipality_canonical_": "Municipality",
        "project_type_": "Project Type",
        "contractor_spec_": "Contractor Specialization",
    }
    for prefix, label in prefix_labels.items():
        if column.startswith(prefix):
            suffix = column[len(prefix):].replace("_", " ").strip()
            return f"{label}: {suffix}"

    known_labels = {
        "AMOUNT (Php)": "Budget (₱, scaled)",
        "Year": "Release Year",
        "days_since_release": "Time Since Release (scaled)",
        "release_month": "Release Month",
        "release_quarter": "Release Quarter",
        "is_wet_season_release": "Wet-Season Release (Jun-Nov)",
        "amount_outlier_flag": "Unusually Large/Small Budget Flag",
        "historical_delay_rate": "Contractor Historical Delay Rate",
        "reliability_score": "Contractor Reliability Score",
    }
    if column in known_labels:
        return known_labels[column]

    return column.replace("_", " ").strip().title()


def top_contributing_features(
    contributions_row: np.ndarray,
    kept_columns: list[str],
    feature_values_row: Optional[pd.Series] = None,
    top_n: int = TOP_N_FEATURES,
) -> list[dict]:
    """Ranks one row's per-feature contributions by |value| and returns the
    top `top_n` as JSON-serializable dicts, ready to store in Supabase's
    `projects.shap_top_features` (jsonb) column and render as a bar chart.

    Guards against NaN in both the SHAP contributions themselves and the
    raw feature values: `build_feature_matrix()` only fills 0.0 for columns
    entirely ABSENT from a row's source data, not per-cell NaN within a
    column that does exist (e.g. `historical_delay_rate` for a project with
    no contractor history) -- some engineered columns genuinely contain NaN
    at inference time, and JSON (unlike Python) has no NaN literal, so an
    un-sanitized NaN reaching json.dumps(..., allow_nan=False) (as httpx's
    request encoder uses) raises ValueError and fails the ENTIRE upsert
    batch, not just the one project."""
    clean_contributions = np.nan_to_num(contributions_row, nan=0.0)
    order = np.argsort(-np.abs(clean_contributions))[:top_n]
    results: list[dict] = []
    for idx in order:
        column = kept_columns[idx]
        value = float(clean_contributions[idx])
        entry = {
            "feature": column,
            "label": humanize_feature_name(column),
            "shap_value": round(value, 5),
            "direction": "increases_risk" if value > 0 else "decreases_risk",
        }
        if feature_values_row is not None and column in feature_values_row.index:
            raw_value = float(feature_values_row[column])
            entry["raw_value"] = raw_value if np.isfinite(raw_value) else None
        results.append(entry)
    return results


def explain_batch(
    rf, xgb, X: pd.DataFrame, kept_columns: list[str], top_n: int = TOP_N_FEATURES,
) -> list[list[dict]]:
    """Batch entry point (used by optimization_engine.py's score_tabular()):
    one call computes SHAP contributions for every row in X at once, which
    is far cheaper than calling explain_single_row() per project."""
    contributions = compute_shap_contributions(rf, xgb, X, kept_columns)
    return [
        top_contributing_features(contributions[i], kept_columns, X.iloc[i], top_n)
        for i in range(len(X))
    ]


def explain_single_row(
    rf, xgb, X: pd.DataFrame, kept_columns: list[str], top_n: int = TOP_N_FEATURES,
) -> list[dict]:
    """Single-project entry point (used by live_scoring.py's
    score_project()) -- X is expected to be a one-row DataFrame."""
    contributions = compute_shap_contributions(rf, xgb, X, kept_columns)
    return top_contributing_features(contributions[0], kept_columns, X.iloc[0], top_n)
