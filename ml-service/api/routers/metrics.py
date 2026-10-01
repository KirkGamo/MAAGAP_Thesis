"""
Model validation metrics.

Read-only view over whatever the training scripts last wrote to artifacts/.
Computes nothing: a retrain is a deliberate act, not a side effect of opening
a page.
"""

from __future__ import annotations

import json
import logging
from typing import Optional

from fastapi import APIRouter, Header, HTTPException

from api.deps import _check_webhook_secret
from inference.live_scoring import ARTIFACTS_DIR

logger = logging.getLogger("maagap.api.metrics")

router = APIRouter()

@router.get("/api/v1/model-metrics")
async def get_model_metrics(
    x_webhook_secret: Optional[str] = Header(None),
):
    """Phase 12, Models tab: read-only validation results for the Level 0
    (Random Forest, XGBoost, LSTM) and Level 1 (meta-learner) stack.

    Deliberately view-only -- this endpoint reads whatever
    train_trees.py/train_lstm.py/train_meta_learner.py last wrote to
    artifacts/*.json, it does NOT trigger a retrain. Confirmed with the
    user before building the Models tab: a live "retrain now" button would
    need real background-job infrastructure (a multi-minute training run
    can't run inline in a request/response cycle), which is a substantially
    bigger addition than displaying already-computed results and carries
    real risk of hanging a request during a live defense demo. If that's
    wanted later, it's a clearly-scoped follow-up, not folded in here.

    The confusion matrix isn't pre-serialized anywhere (only aggregate
    accuracy/precision/recall/F1/AUC-ROC are) -- it's recomputed here from
    meta_learner_test_predictions.csv's y_true/meta_prob columns using the
    same >=0.5 decision threshold train_meta_learner.py used to compute
    its own reported accuracy (recomputing it against y_true confirms this:
    the resulting accuracy matches meta_learner_metrics.json's exactly)."""
    _check_webhook_secret(x_webhook_secret)

    def _read_json(filename: str) -> Optional[dict]:
        path = ARTIFACTS_DIR / filename
        if not path.exists():
            return None
        return json.loads(path.read_text())

    tree_models = _read_json("tree_models_metrics.json")
    lstm = _read_json("lstm_model_metrics.json")
    meta_learner = _read_json("meta_learner_metrics.json")
    # Objective 2's regression half: MAE in days from train_regressors.py.
    # Absent until that script has been run, and the endpoint stays available
    # without it -- the classification artifacts are the required ones.
    regression = _read_json("regression_metrics.json")

    if tree_models is None and lstm is None and meta_learner is None:
        raise HTTPException(
            status_code=404,
            detail=(
                "No training artifacts found yet -- run train_trees.py, "
                "train_lstm.py, and train_meta_learner.py at least once."
            ),
        )

    confusion_matrix = None
    predictions_path = ARTIFACTS_DIR / "meta_learner_test_predictions.csv"
    if predictions_path.exists():
        import csv

        true_positive = false_positive = true_negative = false_negative = 0
        with open(predictions_path, newline="") as f:
            for row in csv.DictReader(f):
                y_true = int(row["y_true"])
                y_pred = 1 if float(row["meta_prob"]) >= 0.5 else 0
                if y_true == 1 and y_pred == 1:
                    true_positive += 1
                elif y_true == 0 and y_pred == 1:
                    false_positive += 1
                elif y_true == 0 and y_pred == 0:
                    true_negative += 1
                else:
                    false_negative += 1
        confusion_matrix = {
            "true_positive": true_positive,
            "false_positive": false_positive,
            "true_negative": true_negative,
            "false_negative": false_negative,
        }

    return {
        "tree_models": tree_models,
        "lstm": lstm,
        "meta_learner": meta_learner,
        "confusion_matrix": confusion_matrix,
        "regression": regression,
    }


