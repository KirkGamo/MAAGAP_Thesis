"""
MAAGAP Level 0 Base Learners — Random Forest & XGBoost
================================================================================
Trains the two tabular Level 0 base learners specified in Chapter 3 on
data/ready/train.csv (produced by feature_engineering.py, Steps 6-11), and
evaluates on data/ready/test.csv.

Critically, this script generates Out-Of-Fold (OOF) predictions via
K-fold cross-validation on the TRAIN set for both models. OOF predictions —
not each model's fitted-on-everything training predictions — are what must
feed the Level 1 Multinomial Logistic Regression meta-learner later: a
model's prediction on a row it was trained on is optimistically biased, and
training the meta-learner on that bias would compound overfitting rather
than genuinely combining the base learners' signal.

IMPORTANT CONTEXT (read before interpreting the metrics below): Phase 6 added
universal proxy-completion-date recovery to feature_engineering.py — for any
project (any year) whose 'Date of Completion' is blank but whose STATUS
confirms it is Completed/Functional, the latest real, independently-recorded
event (a monitoring visit or a liquidation submission) is used as a proxy
completion date, growing the labeled dataset from 231 train / 99 test rows
(Phase 3) to several thousand. This is a genuine recovery of real history,
not fabrication — but the proxy date is a systematically LATE upper bound on
true completion (administrative paperwork commonly trails physical
completion), which measurably inflates the RedFlag positive rate for
proxy-recovered rows relative to directly-observed rows. `run()` logs this
split explicitly every time it executes — read that log line before treating
the headline RedFlag rate or the metrics below at face value.

SCOPE NOTE: RedFlag here is the binary slippage indicator defined in Chapter
3's Target Variable Construction. The four-tier Low/Medium/High/Critical
Risk Scoring output is a separate downstream step (the Level 1 meta-learner
plus the Risk Scoring Module's threshold logic) and is not produced here —
this script's job is exactly the Level 0 P(RedFlag) that feeds it.

Usage:
    python train_trees.py \
        --train-csv ../../data/ready/train.csv \
        --test-csv ../../data/ready/test.csv \
        --artifacts-dir ../artifacts

Requires: pandas, numpy, scikit-learn, xgboost, joblib
================================================================================
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from pathlib import Path
from typing import Optional

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.feature_selection import VarianceThreshold
from sklearn.metrics import (
    accuracy_score, f1_score, precision_score, recall_score, roc_auc_score,
)
from sklearn.model_selection import StratifiedKFold
from xgboost import XGBClassifier

logger = logging.getLogger("maagap.train_trees")
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)

RANDOM_SEED = 42
N_CV_FOLDS = 5

# Columns that must never appear in the feature matrix: identifiers, raw
# free text, and — critically — columns that are algebraically derived from
# (or partially determine) RedFlag itself. T_actual_days/T_standard_days
# together define RedFlag exactly; NegativeSlippage_pct is the same
# computation re-expressed as a percentage; extension_approved is a direct
# input to the RedFlag formula. Including any of these would not be a
# "strong feature" — it would be the label with extra steps.
EXCLUDE_COLS = [
    "RedFlag", "project_key", "mon_row_id",
    "NAME OF PROJECT", "LOCATION", "DATE RELEASED", "DATE MONITORED",
    "Date  of Completion", "REMARKS", "REMARKS_clean", "STATUS", "FILE NAME",
    "No.", "FUNDS RELEASED TO:",
    "T_actual_days", "T_standard_days", "NegativeSlippage_pct",
    "has_completion_date", "completion_date_is_proxy", "extension_approved", "contractor_id",
    # D_start is the resolved (DATE RELEASED, falling back to DATE MONITORED)
    # datetime used to derive release_month/release_quarter/days_since_release/
    # is_wet_season_release in feature_engineering.py -- it's housekeeping for
    # building those features, not itself a model input (datetime64 dtype
    # would be dropped by the non-numeric check below anyway, but excluding
    # it explicitly keeps the "Dropping N unexpected non-numeric column(s)"
    # warning clean). date_released_is_proxy mirrors completion_date_is_proxy's
    # exclusion -- a data-provenance flag about how a date was resolved, not
    # a feature the model should condition its risk prediction on.
    "D_start", "date_released_is_proxy",
    # Added when 20% NTA Monitored / SEF Monitored were folded into the main
    # monitoring population (preprocess.py's fold_in_supplementary_sheets) --
    # a provenance label ("MONITORING REPORT Con" / "20% NTA Monitored" /
    # "SEF Monitored"), not a feature the model should condition on.
    "source_sheet",
]


def build_feature_matrix(
    df: pd.DataFrame, keep_columns: Optional[list[str]] = None,
) -> tuple[pd.DataFrame, list[str]]:
    """
    Selects the numeric/boolean feature columns from an engineered dataframe,
    excluding identifiers, free text, and target-leakage columns.

    If `keep_columns` is given (the column set decided on the TRAIN split),
    the returned frame is reindexed to exactly that column set — filling any
    column absent from `df` with 0 — so train/test/inference always present
    the model with an identical feature schema.
    """
    # Defense-in-depth: preprocess.py's load_core_sheets() now strips and
    # drops whitespace-only column headers at the source (a stray
    # near-duplicate row-index column was previously slipping through with a
    # blank/space-only name, evading EXCLUDE_COLS entirely since no one could
    # type an invisible string into a denylist, and ending up as a real —
    # and meaningless — predictive feature). Guard here too in case any
    # future ingestion path skips that step.
    candidate_cols = [
        c for c in df.columns
        if c not in EXCLUDE_COLS and not (isinstance(c, str) and c.strip() == "")
    ]
    X = df[candidate_cols]

    non_numeric = [c for c in X.columns if not (pd.api.types.is_numeric_dtype(X[c]) or pd.api.types.is_bool_dtype(X[c]))]
    if non_numeric:
        logger.warning("Dropping %d unexpected non-numeric column(s) not caught by EXCLUDE_COLS: %s", len(non_numeric), non_numeric)
        X = X.drop(columns=non_numeric)

    X = X.astype(float)

    if keep_columns is not None:
        X = X.reindex(columns=keep_columns, fill_value=0.0)
        return X, keep_columns

    return X, list(X.columns)


def drop_zero_variance_features(X_train: pd.DataFrame) -> list[str]:
    """
    Drops constant (zero-variance) columns from the TRAIN feature matrix —
    e.g. one-hot categories with no representation at all in this split.
    With 231 train rows and several hundred one-hot columns (municipality,
    status, contractor specialization), a meaningful share are degenerate in
    this specific split; keeping them wastes model capacity without adding
    signal. Returns the surviving column list, to be applied identically to
    test/inference via `build_feature_matrix(..., keep_columns=...)`.
    """
    selector = VarianceThreshold(threshold=0.0)
    selector.fit(X_train)
    kept = X_train.columns[selector.get_support()].tolist()
    logger.info("Feature selection: %d -> %d columns after dropping zero-variance features", X_train.shape[1], len(kept))
    return kept


def generate_oof_predictions(
    model_factory, X: pd.DataFrame, y: np.ndarray, n_splits: int = N_CV_FOLDS, seed: int = RANDOM_SEED,
) -> np.ndarray:
    """
    Generates Out-Of-Fold predicted probabilities for P(RedFlag=1) via
    StratifiedKFold cross-validation: each row's OOF prediction comes from a
    model that never saw that row during training. This is the array that
    must be used to train the Level 1 meta-learner — using in-sample
    predictions from a model fit on the whole training set would leak each
    base learner's own overfitting into the meta-learner's training signal.
    """
    n_pos, n_neg = int(y.sum()), int((y == 0).sum())
    if min(n_pos, n_neg) < n_splits:
        raise ValueError(
            f"Cannot run {n_splits}-fold stratified CV: minority class has only "
            f"{min(n_pos, n_neg)} example(s). Reduce --cv-folds or collect more labeled data."
        )

    oof = np.zeros(len(y), dtype=float)
    skf = StratifiedKFold(n_splits=n_splits, shuffle=True, random_state=seed)
    for fold_i, (train_idx, val_idx) in enumerate(skf.split(X, y)):
        model = model_factory()
        model.fit(X.iloc[train_idx], y[train_idx])
        oof[val_idx] = model.predict_proba(X.iloc[val_idx])[:, 1]
        logger.info("  fold %d/%d: trained on %d rows, predicted %d OOF rows", fold_i + 1, n_splits, len(train_idx), len(val_idx))
    return oof


def evaluate(y_true: np.ndarray, y_prob: np.ndarray, label: str) -> dict:
    y_pred = (y_prob >= 0.5).astype(int)
    metrics = {
        "accuracy": round(float(accuracy_score(y_true, y_pred)), 4),
        "precision": round(float(precision_score(y_true, y_pred, zero_division=0)), 4),
        "recall": round(float(recall_score(y_true, y_pred, zero_division=0)), 4),
        "f1": round(float(f1_score(y_true, y_pred, zero_division=0)), 4),
    }
    try:
        metrics["auc_roc"] = round(float(roc_auc_score(y_true, y_prob)), 4)
    except ValueError as exc:
        metrics["auc_roc"] = None
        logger.warning("%s: AUC-ROC undefined (%s)", label, exc)
    logger.info("%s metrics: %s", label, metrics)
    return metrics


def run(train_csv: Path, test_csv: Path, artifacts_dir: Path, n_splits: int = N_CV_FOLDS, seed: int = RANDOM_SEED) -> dict:
    for p in (train_csv, test_csv):
        if not p.exists():
            raise FileNotFoundError(f"Required input not found: {p}")
    artifacts_dir.mkdir(parents=True, exist_ok=True)

    train_df = pd.read_csv(train_csv, low_memory=False)
    test_df = pd.read_csv(test_csv, low_memory=False)
    if "RedFlag" not in train_df.columns:
        raise ValueError(f"{train_csv} has no RedFlag column — was it produced by feature_engineering.py?")

    logger.warning(
        "Training on %d rows (%d positive) / testing on %d rows (%d positive).",
        len(train_df), int(train_df["RedFlag"].sum()), len(test_df), int(test_df["RedFlag"].sum()),
    )

    if "completion_date_is_proxy" in train_df.columns:
        combined = pd.concat([train_df, test_df])
        proxy_stats = combined.groupby("completion_date_is_proxy")["RedFlag"].agg(["count", "mean"])
        logger.warning(
            "PHASE 6/7 PROXY-DATE CAVEAT — read before trusting the RedFlag positive rate: "
            "directly-observed completion dates show a %.1f%% RedFlag rate (n=%d), while "
            "proxy-recovered completion dates show a %.1f%% RedFlag rate (n=%d) AFTER the "
            "Phase 7 empirical lag correction has already been applied (see "
            "feature_engineering.py's compute_empirical_lag_days — the raw, uncorrected gap "
            "was 82.3%%, the correction pulled it down to this residual gap by shifting proxy "
            "dates back by the calibrated median lag). The remaining gap is expected to be "
            "smaller than before but not necessarily zero: a median-based correction removes "
            "the typical bias, not every project's individual lag, and it is plausible that "
            "projects requiring more liquidation/monitoring paperwork are also somewhat more "
            "likely to be genuinely delayed. Treat the residual gap as a smaller, but still "
            "real, source of uncertainty — not a like-for-like measurement against the "
            "directly-observed subset.",
            float(proxy_stats.loc[False, "mean"]) * 100, int(proxy_stats.loc[False, "count"]),
            float(proxy_stats.loc[True, "mean"]) * 100 if True in proxy_stats.index else float("nan"),
            int(proxy_stats.loc[True, "count"]) if True in proxy_stats.index else 0,
        )

    X_train_full, _ = build_feature_matrix(train_df)
    y_train = train_df["RedFlag"].astype(int).to_numpy()

    kept_columns = drop_zero_variance_features(X_train_full)
    X_train = X_train_full[kept_columns]
    X_test, _ = build_feature_matrix(test_df, keep_columns=kept_columns)
    y_test = test_df["RedFlag"].astype(int).to_numpy()

    scale_pos_weight = float((y_train == 0).sum()) / max(int(y_train.sum()), 1)

    def make_rf():
        return RandomForestClassifier(
            n_estimators=300, max_depth=8, min_samples_leaf=3,
            class_weight="balanced", random_state=seed, n_jobs=-1,
        )

    def make_xgb():
        return XGBClassifier(
            n_estimators=300, max_depth=4, learning_rate=0.05,
            subsample=0.8, colsample_bytree=0.8,
            scale_pos_weight=scale_pos_weight, eval_metric="logloss",
            random_state=seed, n_jobs=-1,
            # Explicit, not a default: xgboost >=2.something flipped
            # XGBClassifier's enable_categorical default from False to True.
            # None of our features are categorical dtype (build_feature_matrix
            # casts everything to float64), so this has no effect on what the
            # model actually learns -- but SHAP's TreeExplainer refuses to run
            # in interventional/probability mode against ANY model with this
            # flag set to True, regardless of whether categorical splits are
            # actually used (see inference/explain.py's shared-background-
            # sample design). Pinning it False keeps SHAP working without
            # changing the trained model's predictions.
            enable_categorical=False,
        )

    results: dict = {"n_train": len(train_df), "n_test": len(test_df),
                      "n_train_positive": int(y_train.sum()), "n_test_positive": int(y_test.sum()),
                      "n_features": len(kept_columns)}

    oof_df = pd.DataFrame({"project_key": train_df["project_key"], "y_true": y_train})
    test_pred_df = pd.DataFrame({"project_key": test_df["project_key"], "y_true": y_test})

    for name, factory in (("random_forest", make_rf), ("xgboost", make_xgb)):
        logger.info("=== %s ===", name)
        logger.info("Generating OOF predictions via %d-fold stratified CV", n_splits)
        oof_probs = generate_oof_predictions(factory, X_train, y_train, n_splits=n_splits, seed=seed)
        oof_df[f"{name}_oof_prob"] = oof_probs
        oof_metrics = evaluate(y_train, oof_probs, f"{name} (OOF, train)")

        final_model = factory()
        final_model.fit(X_train, y_train)
        test_probs = final_model.predict_proba(X_test)[:, 1]
        test_pred_df[f"{name}_test_prob"] = test_probs
        test_metrics = evaluate(y_test, test_probs, f"{name} (test)")

        model_path = artifacts_dir / f"{name}.joblib"
        joblib.dump(final_model, model_path)
        logger.info("Saved %s to %s", name, model_path)

        results[name] = {"oof_metrics": oof_metrics, "test_metrics": test_metrics}

    oof_df.to_csv(artifacts_dir / "oof_predictions_tabular.csv", index=False)
    test_pred_df.to_csv(artifacts_dir / "test_predictions_tabular.csv", index=False)
    with open(artifacts_dir / "tabular_feature_columns.json", "w") as f:
        json.dump(kept_columns, f)
    with open(artifacts_dir / "tree_models_metrics.json", "w") as f:
        json.dump(results, f, indent=2)

    logger.info("Artifacts written to %s", artifacts_dir.resolve())
    return results


def parse_args(argv: Optional[list[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Train MAAGAP Level 0 tree-based base learners (RF, XGBoost).")
    parser.add_argument("--train-csv", type=Path, default=Path("../../data/ready/train.csv"))
    parser.add_argument("--test-csv", type=Path, default=Path("../../data/ready/test.csv"))
    parser.add_argument("--artifacts-dir", type=Path, default=Path("../artifacts"))
    parser.add_argument("--cv-folds", type=int, default=N_CV_FOLDS)
    parser.add_argument("--seed", type=int, default=RANDOM_SEED)
    return parser.parse_args(argv)


def main(argv: Optional[list[str]] = None) -> int:
    args = parse_args(argv)
    try:
        run(args.train_csv, args.test_csv, args.artifacts_dir, args.cv_folds, args.seed)
    except (FileNotFoundError, ValueError) as exc:
        logger.error("Aborted: %s", exc)
        return 1
    except Exception:
        logger.exception("Training failed with an unexpected error.")
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
