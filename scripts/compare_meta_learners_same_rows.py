"""
MAAGAP — is the LSTM earning its place? Compare both meta-learners on IDENTICAL rows.
================================================================================
The stored metrics appear to say the two-learner model beats the three-learner
one on every measure:

    three-learner (n=598)    acc 0.8880  prec 0.8514  rec 0.8760  AUC 0.9581
    two-learner   (n=1765)   acc 0.9258  prec 0.9475  rec 0.9125  AUC 0.9762

That comparison is CONFOUNDED and must not be reported as-is. The two models are
scored on different populations: the three-learner can only be evaluated on test
rows that have an LSTM sequence (598 of 1,765), while the two-learner is
evaluated on all 1,765. Projects with enough monitoring events to form a
sequence are plausibly a harder subpopulation -- more site activity, longer
duration, more that can go wrong -- so the three-learner's weaker numbers may
reflect a harder sample rather than a worse model.

The only valid question is: on the SAME 598 rows, which model predicts better?

This script answers it by rebuilding the tabular base-learner probabilities for
those exact rows, scoring the two-learner model on them, and comparing against
the three-learner's already-stored predictions for the identical project_keys.

    python scripts/compare_meta_learners_same_rows.py

Reports paired metrics plus a McNemar test, because the two models are evaluated
on the same rows and a paired test is what that design calls for -- an unpaired
comparison of two accuracies on identical samples overstates the uncertainty.
"""

from __future__ import annotations

import json
import logging
import sys
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.metrics import (
    accuracy_score,
    f1_score,
    precision_score,
    recall_score,
    roc_auc_score,
)

REPO_ROOT = Path(__file__).resolve().parent.parent
ML_DIR = REPO_ROOT / "ml-service"
sys.path.insert(0, str(ML_DIR))
sys.path.insert(0, str(ML_DIR / "models"))

ARTIFACTS = ML_DIR / "artifacts"
DATA_READY = REPO_ROOT / "data" / "ready"

logging.basicConfig(level=logging.WARNING, format="%(message)s")
logger = logging.getLogger("compare_meta_learners")


def metrics(y_true: np.ndarray, prob: np.ndarray, threshold: float = 0.5) -> dict:
    pred = (prob >= threshold).astype(int)
    return {
        "accuracy": accuracy_score(y_true, pred),
        "precision": precision_score(y_true, pred, zero_division=0),
        "recall": recall_score(y_true, pred, zero_division=0),
        "f1": f1_score(y_true, pred, zero_division=0),
        "auc_roc": roc_auc_score(y_true, prob) if len(set(y_true)) > 1 else float("nan"),
    }


def main() -> int:
    from train_trees import build_feature_matrix  # noqa: E402

    three = pd.read_csv(ARTIFACTS / "meta_learner_test_predictions.csv")
    keys = three["project_key"].tolist()
    print(f"Three-learner test rows (those WITH an LSTM sequence): {len(keys)}")

    test = pd.read_csv(DATA_READY / "test.csv", low_memory=False)
    subset = test[test["project_key"].isin(keys)].copy()
    print(f"Matched in test.csv: {len(subset)}")
    if len(subset) != len(keys):
        print("  WARNING: not every key matched; comparing on the intersection only.")

    kept = json.load(open(ARTIFACTS / "tabular_feature_columns.json"))
    X, _ = build_feature_matrix(subset, keep_columns=kept)

    rf = joblib.load(ARTIFACTS / "random_forest.joblib")
    xgb = joblib.load(ARTIFACTS / "xgboost.joblib")
    rf_prob = rf.predict_proba(X)[:, 1]
    xgb_prob = xgb.predict_proba(X)[:, 1]

    two_model = joblib.load(ARTIFACTS / "meta_learner_two.joblib")
    two_prob = two_model.predict_proba(np.column_stack([rf_prob, xgb_prob]))[:, 1]

    # Align the stored three-learner predictions to the same row order.
    order = subset["project_key"].tolist()
    three_indexed = three.set_index("project_key").loc[order]
    y_true = three_indexed["y_true"].to_numpy()
    three_prob = three_indexed["meta_prob"].to_numpy()

    m3, m2 = metrics(y_true, three_prob), metrics(y_true, two_prob)

    print()
    print("=" * 66)
    print(f"  PAIRED COMPARISON on the same {len(y_true)} rows")
    print("=" * 66)
    print(f"  {'metric':12} {'three-learner':>14} {'two-learner':>13} {'delta':>9}")
    for k in ("accuracy", "precision", "recall", "f1", "auc_roc"):
        d = m2[k] - m3[k]
        print(f"  {k:12} {m3[k]:14.4f} {m2[k]:13.4f} {d:+9.4f}")

    # McNemar: the right test for two classifiers on identical samples.
    p3 = (three_prob >= 0.5).astype(int)
    p2 = (two_prob >= 0.5).astype(int)
    b = int(np.sum((p3 == y_true) & (p2 != y_true)))   # three right, two wrong
    c = int(np.sum((p3 != y_true) & (p2 == y_true)))   # two right, three wrong
    print()
    print(f"  McNemar discordant pairs: three-only-correct={b}, two-only-correct={c}")
    if b + c > 0:
        from scipy.stats import binomtest

        p = binomtest(min(b, c), b + c, 0.5).pvalue
        print(f"  exact two-sided p = {p:.4g}")
        verdict = (
            "the difference is statistically significant"
            if p < 0.05
            else "NOT statistically significant — the models are indistinguishable here"
        )
        print(f"  -> {verdict}")
    else:
        print("  -> the two models agree on every row")

    out = REPO_ROOT / "ml-service" / "artifacts" / "meta_learner_paired_comparison.json"
    out.write_text(
        json.dumps(
            {
                "n_rows": int(len(y_true)),
                "population": "test rows WITH an LSTM sequence",
                "three_learner": m3,
                "two_learner": m2,
                "mcnemar": {"three_only_correct": b, "two_only_correct": c},
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    print(f"\nwrote {out.relative_to(REPO_ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
