"""
MAAGAP — Level 1 Meta-Learner (Stacking Ensemble Finalization)
================================================================

Trains the Level 1 Multinomial Logistic Regression meta-learner on top of
the Level 0 base-learner Out-Of-Fold (OOF) predictions produced by
`train_trees.py` (Random Forest, XGBoost) and `train_lstm.py` (LSTM).

WHY OOF PREDICTIONS, NOT IN-SAMPLE PREDICTIONS
------------------------------------------------
Training the meta-learner on Level 0 models' in-sample (training-set)
predictions would leak information: a base learner's prediction on a row
it was trained on is artificially confident, so the meta-learner would
learn to trust an over-fit signal that will not hold on genuinely unseen
data. `oof_predictions_tabular.csv` and `oof_predictions_lstm.csv` instead
hold each base learner's prediction on rows it did NOT see during that
fold's training (via StratifiedKFold), which is the statistically valid
input for a Level 1 model in a stacking ensemble.

KNOWN CAVEAT CARRIED FORWARD FROM LEVEL 0 TRAINING (do not paper over)
------------------------------------------------------------------------
Phase 6 added universal proxy-completion-date recovery to
feature_engineering.py, growing the resolved (labeled) population from the
original Phase 3 baseline (231 train / 99 test rows, ~7.6% RedFlag
positive) to several thousand rows. This is real, recovered history, not a
statistical fabrication — but proxy-recovered rows (see
`completion_date_is_proxy` in data/ready/train.csv/test.csv) use the LATEST
recorded monitoring visit or liquidation submission as a stand-in for the
true completion date, which is a systematically LATE upper bound and
therefore inflates the apparent RedFlag rate for that subset relative to
directly-observed rows (train_trees.py logs the exact split every run).
The meta-learner is trained on Level 0 OOF probabilities that already carry
this bias forward, so its much-improved headline metrics below should be
read as "how well the ensemble separates risk under the current proxy-date
methodology," not as a bias-free estimate of true delay-prediction accuracy.
This should be reported alongside the Level 0 metrics in the Results and
Discussion chapter, not omitted just because the numbers look stronger now.

RISK TIER THRESHOLDS (Chapter 3 — must match manuscript exactly)
-------------------------------------------------------------------
The meta-learner outputs P(RedFlag=1). That probability is binned into
the four discrete risk tiers exactly as specified in Chapter 3:

    Low       : 0.0 <= p < 0.3
    Medium    : 0.3 <= p < 0.7
    High      : 0.7 <= p < 0.9
    Critical  : 0.9 <= p <= 1.0

These boundaries are implemented in `probability_to_risk_tier()` below.
Change them there AND in the manuscript together if they ever need to
move — they must never drift out of sync.

Outputs
-------
    ml-service/artifacts/meta_learner.joblib          (trained sklearn model)
    ml-service/artifacts/meta_learner_metrics.json     (test-set evaluation)
    ml-service/artifacts/meta_learner_test_predictions.csv
                                                        (per-project probability + risk tier)

Usage
-----
    python train_meta_learner.py
"""

from __future__ import annotations

import json
import logging
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    accuracy_score,
    f1_score,
    precision_score,
    recall_score,
    roc_auc_score,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("train_meta_learner")

ARTIFACTS_DIR = Path(__file__).resolve().parent.parent / "artifacts"
READY_DATA_DIR = Path(__file__).resolve().parent.parent.parent / "data" / "ready"

# ---------------------------------------------------------------------------
# Risk tier thresholds — must match Chapter 3 exactly.
# ---------------------------------------------------------------------------

RISK_TIER_THRESHOLDS = {
    "Low": (0.0, 0.3),
    "Medium": (0.3, 0.7),
    "High": (0.7, 0.9),
    "Critical": (0.9, 1.0),
}


def probability_to_risk_tier(prob: float) -> str:
    """Map a single P(RedFlag=1) probability to one of the four Chapter 3
    risk tiers. Boundaries: Low [0, 0.3), Medium [0.3, 0.7), High [0.7, 0.9),
    Critical [0.9, 1.0]."""
    if prob < 0.3:
        return "Low"
    if prob < 0.7:
        return "Medium"
    if prob < 0.9:
        return "High"
    return "Critical"


def probabilities_to_risk_tiers(probs: np.ndarray) -> np.ndarray:
    return np.array([probability_to_risk_tier(p) for p in probs])


# ---------------------------------------------------------------------------
# Step 1 — load and align OOF predictions from both Level 0 learners
# ---------------------------------------------------------------------------


def load_oof_predictions() -> pd.DataFrame:
    """
    Load oof_predictions_tabular.csv (project_key, y_true, random_forest_oof_prob,
    xgboost_oof_prob) and oof_predictions_lstm.csv (project_key, y_true,
    lstm_oof_prob), align by project_key, and return one merged frame.

    Not every resolved project necessarily has an LSTM sequence (a project
    could be missing enough fund-release events to build a sequence, or
    vice versa) — an inner join keeps only projects with OOF coverage from
    ALL three base learners, since the meta-learner needs a complete
    feature vector per row. Rows dropped by the join are logged so the
    coverage loss is visible rather than silent.
    """
    tabular_path = ARTIFACTS_DIR / "oof_predictions_tabular.csv"
    lstm_path = ARTIFACTS_DIR / "oof_predictions_lstm.csv"

    tabular_oof = pd.read_csv(tabular_path)
    lstm_oof = pd.read_csv(lstm_path)

    merged = tabular_oof.merge(
        lstm_oof[["project_key", "lstm_oof_prob"]],
        on="project_key",
        how="inner",
    )

    dropped = len(tabular_oof) - len(merged)
    if dropped > 0:
        logger.warning(
            "%d of %d tabular OOF rows had no matching LSTM OOF prediction and were "
            "dropped from meta-learner training (no LSTM sequence available for those "
            "projects).",
            dropped,
            len(tabular_oof),
        )

    # y_true should agree between the two sources for any row that
    # survives the join; assert this rather than silently trusting one.
    mismatch = merged["y_true_x"] != merged["y_true_y"] if "y_true_y" in merged.columns else pd.Series(dtype=bool)
    if "y_true_y" in merged.columns:
        if mismatch.any():
            raise ValueError(
                f"y_true mismatch between tabular and LSTM OOF files for "
                f"{mismatch.sum()} project(s) — investigate before training the meta-learner."
            )
        merged = merged.rename(columns={"y_true_x": "y_true"}).drop(columns=["y_true_y"])

    return merged


def load_test_predictions() -> pd.DataFrame:
    """Same alignment as `load_oof_predictions`, but for the held-out test
    set's base-learner predictions (test_predictions_tabular.csv /
    test_predictions_lstm.csv) — used only for final meta-learner
    evaluation, never for fitting."""
    tabular_path = ARTIFACTS_DIR / "test_predictions_tabular.csv"
    lstm_path = ARTIFACTS_DIR / "test_predictions_lstm.csv"

    tabular_test = pd.read_csv(tabular_path)
    lstm_test = pd.read_csv(lstm_path)

    merged = tabular_test.merge(
        lstm_test[["project_key", "lstm_test_prob"]],
        on="project_key",
        how="inner",
    )

    dropped = len(tabular_test) - len(merged)
    if dropped > 0:
        logger.warning(
            "%d of %d tabular test rows had no matching LSTM test prediction and were "
            "dropped from meta-learner evaluation.",
            dropped,
            len(tabular_test),
        )

    if "y_true_y" in merged.columns:
        mismatch = merged["y_true_x"] != merged["y_true_y"]
        if mismatch.any():
            raise ValueError(
                f"y_true mismatch between tabular and LSTM test files for "
                f"{mismatch.sum()} project(s) — investigate before evaluating the meta-learner."
            )
        merged = merged.rename(columns={"y_true_x": "y_true"}).drop(columns=["y_true_y"])

    return merged


# ---------------------------------------------------------------------------
# Step 2 — train the Level 1 meta-learner
# ---------------------------------------------------------------------------

META_FEATURE_COLUMNS = ["random_forest_oof_prob", "xgboost_oof_prob", "lstm_oof_prob"]
META_FEATURE_COLUMNS_TEST = ["random_forest_test_prob", "xgboost_test_prob", "lstm_test_prob"]


def train_meta_learner(oof_df: pd.DataFrame) -> LogisticRegression:
    """
    Fit a Multinomial (softmax) Logistic Regression using the three Level 0
    OOF probabilities as features and the binary RedFlag label as target.

    Note: RedFlag itself is a binary target (0/1), not the four-tier risk
    label — the four risk tiers are a downstream probability binning
    (see `probability_to_risk_tier`), not a separate classification
    target the meta-learner is fit against. The manuscript specifies a
    "Multinomial Logistic Regression" meta-learner; scikit-learn's
    LogisticRegression IS a multinomial (softmax) logistic regression
    model by default (its `multi_class` param — now deprecated as of
    sklearn 1.5 — only ever mattered for >2 classes). With a binary
    RedFlag target this reduces to standard binary logistic regression,
    which is mathematically the 2-class special case of the multinomial
    formulation, so no explicit `multi_class` argument is passed here.
    If a directly 4-class target is adopted later, this same model class
    handles that case unchanged.
    """
    X = oof_df[META_FEATURE_COLUMNS].values
    y = oof_df["y_true"].values

    n_pos = int(y.sum())
    if n_pos < 2:
        logger.warning(
            "Only %d positive example(s) in the meta-learner training set — "
            "class_weight='balanced' is used to compensate, but treat metrics "
            "as illustrative given the sample size.",
            n_pos,
        )

    model = LogisticRegression(
        solver="lbfgs",
        class_weight="balanced",
        max_iter=1000,
    )
    model.fit(X, y)
    return model


# ---------------------------------------------------------------------------
# Step 3 — evaluate on the held-out test set
# ---------------------------------------------------------------------------


def evaluate(model: LogisticRegression, test_df: pd.DataFrame) -> dict:
    X_test = test_df[META_FEATURE_COLUMNS_TEST].values
    y_test = test_df["y_true"].values

    probs = model.predict_proba(X_test)[:, 1]
    preds = (probs >= 0.5).astype(int)

    metrics = {
        "accuracy": float(accuracy_score(y_test, preds)),
        "precision": float(precision_score(y_test, preds, zero_division=0)),
        "recall": float(recall_score(y_test, preds, zero_division=0)),
        "f1": float(f1_score(y_test, preds, zero_division=0)),
    }
    try:
        metrics["auc_roc"] = float(roc_auc_score(y_test, probs))
    except ValueError as exc:
        logger.warning("AUC-ROC undefined on test set: %s", exc)
        metrics["auc_roc"] = None

    risk_tiers = probabilities_to_risk_tiers(probs)
    tier_counts = pd.Series(risk_tiers).value_counts().to_dict()
    metrics["risk_tier_distribution"] = {k: int(v) for k, v in tier_counts.items()}

    return metrics, probs, risk_tiers


# ---------------------------------------------------------------------------
# Orchestration
# ---------------------------------------------------------------------------


def run() -> None:
    ARTIFACTS_DIR.mkdir(parents=True, exist_ok=True)

    logger.info("Loading and aligning OOF predictions for meta-learner training...")
    oof_df = load_oof_predictions()
    logger.info("Meta-learner training set: %d rows (%d positive)", len(oof_df), int(oof_df["y_true"].sum()))

    model = train_meta_learner(oof_df)

    logger.info("Loading and aligning held-out test predictions for evaluation...")
    test_df = load_test_predictions()
    metrics, probs, risk_tiers = evaluate(model, test_df)
    logger.info("Meta-learner test metrics: %s", json.dumps(metrics, indent=2))

    model_path = ARTIFACTS_DIR / "meta_learner.joblib"
    joblib.dump(model, model_path)
    logger.info("Saved meta-learner to %s", model_path)

    metrics_path = ARTIFACTS_DIR / "meta_learner_metrics.json"
    with open(metrics_path, "w") as f:
        json.dump(metrics, f, indent=2)
    logger.info("Saved metrics to %s", metrics_path)

    predictions_out = test_df[["project_key", "y_true"]].copy()
    predictions_out["meta_prob"] = probs
    predictions_out["risk_tier"] = risk_tiers
    predictions_path = ARTIFACTS_DIR / "meta_learner_test_predictions.csv"
    predictions_out.to_csv(predictions_path, index=False)
    logger.info("Saved per-project test predictions + risk tiers to %s", predictions_path)


if __name__ == "__main__":
    run()
