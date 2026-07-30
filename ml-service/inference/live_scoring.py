"""
MAAGAP — Live Single-Project Re-scoring
================================================================================
Backs the FastAPI feedback-loop endpoint (`main.py`'s
`POST /api/v1/update-monitoring`): given a single project_key and a new
field-monitoring observation (status, optional % complete, optional amount
spent, and an observation timestamp), this module refreshes that ONE
project's time-elapsed features and event sequence, re-runs it through the
already-trained Level 0/Level 1 artifacts, and returns a fresh risk score.

SCOPE — WHAT THIS DOES AND DOES NOT DO (read before extending)
------------------------------------------------------------------------------
This endpoint refreshes the LIVE risk score shown to Managers/Inspectors
using the CURRENTLY TRAINED, FROZEN models (random_forest.joblib,
xgboost.joblib, lstm_model.keras, meta_learner.joblib). It does **not**:

  - Retrain any model. A single new observation is nowhere near enough
    signal to justify a retrain, and retraining on every incoming report
    would make the system's behavior nondeterministic and expensive. Full
    retraining remains the periodic (e.g. quarterly) batch job described in
    docs/MODEL_IMPROVEMENT_STRATEGY.md Section 4.
  - Move a project between train.csv/test.csv/inference.csv. That
    partitioning is decided by feature_engineering.py's full pipeline run
    (which also handles the Phase 6/7 proxy-completion-date recovery); a
    single live update does not re-run that pipeline. If a project's
    reported status becomes "completed", this module updates its bookkeeping
    fields for scoring purposes but the authoritative move into the
    resolved training population still happens the next time
    feature_engineering.py is re-run against a refreshed PPDO export.
  - Incorporate brand-new feature signals (e.g. "percent complete") into
    the model's prediction directly. The trained models' feature schema is
    fixed (see ml-service/artifacts/tabular_feature_columns.json) — a
    feature the model was never trained on cannot influence its output
    just by being present in the input row. `percent_complete` and
    `amount_spent` are recorded for bookkeeping/audit purposes and would
    need to be added to feature_engineering.py's Step 9 and a full retrain
    before they could affect a risk score. This is a real, load-bearing
    constraint of "incremental scoring without retraining," not an
    oversight — it is called out explicitly here so it isn't rediscovered
    the hard way later.

What DOES genuinely change on every call, and genuinely can move the score:
  - `days_since_release` (and any other now-vs-release-date feature) is
    recomputed against the CURRENT observation timestamp rather than the
    frozen `DATASET_HORIZON` baked into the last full pipeline run — a
    project that has been sitting released-but-unfinished for longer now
    than at last full pipeline run should look riskier to the tree models'
    "how much time has elapsed" features, and this refresh is what makes
    that show up between full retraining cycles.
  - The STATUS one-hot columns are updated to reflect the newly reported
    status.
  - The project's LSTM event sequence gains a new (event_type=2,
    days_since_anchor, amount) monitoring-visit entry, re-sorted and
    re-truncated/padded exactly as `assemble_lstm_sequences` does at
    pipeline-build time, then re-scaled with the ALREADY-FITTED (never
    re-fit) train-time sequence scaler.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import joblib
import numpy as np
import pandas as pd

logger = logging.getLogger("maagap.live_scoring")

THIS_DIR = Path(__file__).resolve().parent
ML_SERVICE_DIR = THIS_DIR.parent
REPO_ROOT = ML_SERVICE_DIR.parent
DATA_READY_DIR = REPO_ROOT / "data" / "ready"
ARTIFACTS_DIR = ML_SERVICE_DIR / "artifacts"
LIVE_SCORES_PATH = ARTIFACTS_DIR / "live_scores.json"

MAX_LSTM_SEQUENCE_LENGTH = 5
PAD_VALUE = -1.0

# Mirrors preprocess.py's STATUS_LOOKUP canonical labels — kept as a small,
# local copy rather than importing preprocess.py's full module, since this
# endpoint only needs the forward mapping from a normalized inspector-app
# status string to the one-hot column suffix the trained feature schema
# actually contains.
STATUS_TO_COLUMN_SUFFIX = {
    "completed": "Completed/Functional",
    "on_going": "On-going",
    "not_yet_implemented": "Not Implemented",
    "for_bidding": "For Bidding",
}


def probability_to_risk_tier(prob: float) -> str:
    """Must match train_meta_learner.py's thresholds exactly (Chapter 3)."""
    if prob < 0.3:
        return "Low"
    if prob < 0.7:
        return "Medium"
    if prob < 0.9:
        return "High"
    return "Critical"


@dataclass
class LiveScoreResult:
    project_key: str
    found: bool
    risk_tier: Optional[str] = None
    meta_prob: Optional[float] = None
    random_forest_prob: Optional[float] = None
    xgboost_prob: Optional[float] = None
    lstm_prob: Optional[float] = None
    # Phase 22: top SHAP-contributing features for this one project (mean of
    # Random Forest's/XGBoost's probability-space contributions -- see
    # inference/explain.py). None if SHAP computation itself failed; a live
    # rescore should never fail outright just because its explanation did.
    shap_top_features: Optional[list] = None
    message: str = ""


def _find_project_row(project_key: str) -> tuple[Optional[pd.DataFrame], Optional[int], str]:
    """Locates project_key in inference.csv (the live/ongoing population).
    Returns (dataframe, row_index, source_label). If the project is already
    resolved (present in train.csv/test.csv instead), returns
    (None, None, "resolved") — see module docstring for why this endpoint
    doesn't attempt to re-score an already-resolved project."""
    inference_path = DATA_READY_DIR / "inference.csv"
    if not inference_path.exists():
        raise FileNotFoundError(f"{inference_path} not found — has feature_engineering.py been run?")

    inference_df = pd.read_csv(inference_path, low_memory=False)
    matches = inference_df.index[inference_df["project_key"] == project_key].tolist()
    if matches:
        return inference_df, matches[0], "inference"

    for split in ("train.csv", "test.csv"):
        split_path = DATA_READY_DIR / split
        if split_path.exists():
            split_df = pd.read_csv(split_path, low_memory=False, usecols=["project_key"])
            if (split_df["project_key"] == project_key).any():
                return None, None, "resolved"

    return None, None, "not_found"


def _update_status_columns(row: pd.Series, status_observed: str) -> pd.Series:
    """Zeroes every STATUS_clean_* one-hot column on this row and sets the
    one matching the newly-observed status, if the trained feature schema
    has a column for it. Unrecognized statuses are logged and left as-is
    (the row keeps its previous STATUS one-hot encoding) rather than
    guessing at a new column name that wasn't in the training schema."""
    target_suffix = STATUS_TO_COLUMN_SUFFIX.get(status_observed)
    if target_suffix is None:
        logger.warning("Unrecognized status_observed=%r — leaving STATUS columns unchanged.", status_observed)
        return row

    status_cols = [c for c in row.index if isinstance(c, str) and c.startswith("STATUS_clean_")]
    target_col = f"STATUS_clean_{target_suffix}"
    if target_col not in status_cols:
        logger.warning(
            "Column %s not present in this row's schema (status wasn't seen often enough at train "
            "time to get its own one-hot column) — leaving STATUS columns unchanged.",
            target_col,
        )
        return row

    for col in status_cols:
        row[col] = 1.0 if col == target_col else 0.0
    return row


def _refresh_temporal_features(row: pd.Series, observed_at: datetime) -> pd.Series:
    """Recomputes now-vs-release-date features against the CURRENT
    observation time, rather than the frozen DATASET_HORIZON baked in at
    last full pipeline run — see module docstring.

    IMPORTANT: `days_since_release` in inference.csv is not raw day counts —
    feature_engineering.py's Step 11 (`normalize_and_split`/`apply_scaler`)
    min-max scales it (and AMOUNT/NegativeSlippage_pct) using scale
    parameters fit on the TRAIN split alone (data/ready/scaler_params.json).
    Writing a raw day count into that column would silently corrupt the
    feature (the trained models were never shown values outside [0, 1] for
    this column), so this function reproduces `apply_scaler`'s exact
    min-max-then-clip transform rather than assigning the raw delta."""
    released = pd.to_datetime(row.get("DATE RELEASED"), errors="coerce")
    if pd.notna(released):
        raw_days = (pd.Timestamp(observed_at) - released).days
        scaler_params = json.load(open(DATA_READY_DIR / "scaler_params.json"))
        params = scaler_params.get("days_since_release")
        if params is not None:
            denom = (params["max"] - params["min"]) or 1.0
            row["days_since_release"] = min(1.0, max(0.0, (raw_days - params["min"]) / denom))
        else:
            logger.warning("scaler_params.json missing 'days_since_release' — leaving column unchanged.")
    return row


def _rebuild_lstm_sequence(
    project_key: str, observed_at: datetime, amount: float,
) -> Optional[tuple[np.ndarray, np.ndarray]]:
    """Appends a new (event_type=2, days_since_anchor, amount) monitoring
    event to this project's existing inference-time sequence, re-sorted and
    re-truncated/padded exactly as assemble_lstm_sequences() does at
    pipeline-build time. Returns (sequence, mask) for this one project, or
    None if the project has no existing LSTM sequence (not every ongoing
    project has one — see optimization_engine.py's coverage caveat)."""
    keys_path = DATA_READY_DIR / "lstm_inference_project_keys.json"
    seq_path = DATA_READY_DIR / "lstm_inference_sequences.npy"
    mask_path = DATA_READY_DIR / "lstm_inference_sequence_mask.npy"
    if not (keys_path.exists() and seq_path.exists() and mask_path.exists()):
        return None

    project_keys = json.load(open(keys_path))
    if project_key not in project_keys:
        return None
    idx = project_keys.index(project_key)

    sequences = np.load(seq_path)
    masks = np.load(mask_path)
    existing_seq = sequences[idx]
    existing_mask = masks[idx]

    # Reconstruct absolute dates for existing real events. The anchor is
    # the earliest event at original construction time, i.e. row where
    # days_since_anchor == 0 among real (non-padding) rows.
    real_rows = existing_seq[existing_mask]
    if len(real_rows) == 0:
        anchor_date = pd.Timestamp(observed_at)
        events: list[tuple[pd.Timestamp, int, float]] = []
    else:
        anchor_offset_idx = int(np.argmin(real_rows[:, 1]))
        anchor_day_offset = real_rows[anchor_offset_idx, 1]
        # anchor_date is whatever absolute date corresponds to offset 0;
        # since the earliest real event's offset IS 0 by construction, the
        # anchor date equals "now" minus nothing meaningful without a
        # stored absolute reference -- so we anchor on DATE RELEASED
        # instead (the tabular row, fetched by the caller) when available,
        # falling back to treating the earliest stored event as day 0 from
        # itself if not.
        anchor_date = pd.Timestamp(observed_at) - pd.Timedelta(days=int(real_rows[:, 1].max()))
        events = [
            (anchor_date + pd.Timedelta(days=int(r[1])), int(r[0]), float(r[2]))
            for r in real_rows
        ]

    new_event = (pd.Timestamp(observed_at), 2, amount)
    events.append(new_event)
    events.sort(key=lambda e: e[0])
    if events:
        anchor_date = events[0][0]

    seq = np.full((MAX_LSTM_SEQUENCE_LENGTH, existing_seq.shape[1]), PAD_VALUE, dtype=np.float32)
    mask = np.zeros(MAX_LSTM_SEQUENCE_LENGTH, dtype=bool)
    for step_i, (event_date, event_type, event_amount) in enumerate(events[:MAX_LSTM_SEQUENCE_LENGTH]):
        seq[step_i] = [event_type, float((event_date - anchor_date).days), event_amount]
        mask[step_i] = True

    return seq, mask


def score_project(
    project_key: str,
    status_observed: str,
    observed_at: datetime,
    percent_complete: Optional[float] = None,
    amount_spent: Optional[float] = None,
) -> LiveScoreResult:
    """Full live re-scoring for one project. Imports train_trees/train_lstm
    lazily (rather than at module load) so importing this module doesn't
    require TensorFlow unless a request actually needs the LSTM path."""
    import sys
    sys.path.insert(0, str(ML_SERVICE_DIR / "models"))
    from train_trees import build_feature_matrix  # noqa: E402

    # All date arithmetic in this module compares against tz-naive dates
    # parsed from the CSV pipeline (pandas defaults to tz-naive). main.py's
    # caller may pass a tz-aware UTC datetime (its own default is
    # `datetime.now(timezone.utc)`) — normalize to tz-naive once, here, so
    # every downstream subtraction is consistent rather than raising
    # "Cannot subtract tz-naive and tz-aware" deep in a helper.
    if observed_at.tzinfo is not None:
        observed_at = observed_at.astimezone(timezone.utc).replace(tzinfo=None)

    inference_df, row_idx, source = _find_project_row(project_key)

    if source == "resolved":
        return LiveScoreResult(
            project_key=project_key, found=False,
            message="Project is already resolved (in train.csv/test.csv), not part of the "
                    "live ongoing population this endpoint re-scores.",
        )
    if source == "not_found":
        return LiveScoreResult(project_key=project_key, found=False, message="project_key not found.")

    row = inference_df.loc[row_idx].copy()
    row = _update_status_columns(row, status_observed)
    row = _refresh_temporal_features(row, observed_at)

    kept_columns_path = ARTIFACTS_DIR / "tabular_feature_columns.json"
    kept_columns = json.load(open(kept_columns_path))
    single_row_df = pd.DataFrame([row])
    X, _ = build_feature_matrix(single_row_df, keep_columns=kept_columns)

    rf = joblib.load(ARTIFACTS_DIR / "random_forest.joblib")
    xgb = joblib.load(ARTIFACTS_DIR / "xgboost.joblib")
    rf_prob = float(rf.predict_proba(X)[:, 1][0])
    xgb_prob = float(xgb.predict_proba(X)[:, 1][0])

    # Relative import (not `from inference.explain import ...`) since this
    # module IS part of the `inference` package -- avoids depending on
    # ml-service/ being on sys.path, which is guaranteed when main.py's
    # FastAPI app runs but not necessarily true for every other caller.
    from .explain import explain_single_row

    try:
        shap_top_features = explain_single_row(rf, xgb, X, kept_columns)
    except Exception:
        logger.exception(
            "SHAP explanation failed for %s -- continuing with the re-score itself, "
            "shap_top_features will be left unset for this update.",
            project_key,
        )
        shap_top_features = None

    lstm_prob: Optional[float] = None
    rebuilt = _rebuild_lstm_sequence(project_key, observed_at, amount_spent or 0.0)
    if rebuilt is not None:
        from train_lstm import apply_sequence_scaler  # noqa: E402
        import os
        os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "3")
        from tensorflow import keras  # noqa: E402

        seq, mask = rebuilt
        scaler_params = json.load(open(ARTIFACTS_DIR / "lstm_sequence_scaler.json"))
        scaled = apply_sequence_scaler(seq[np.newaxis, ...], mask[np.newaxis, ...], scaler_params)
        lstm_model = keras.models.load_model(ARTIFACTS_DIR / "lstm_model.keras")
        lstm_prob = float(lstm_model.predict(scaled, verbose=0).ravel()[0])
    else:
        logger.info(
            "No LSTM sequence available for %s — scoring with tabular base learners only "
            "is not supported by the current 3-feature meta-learner. Falling back to the "
            "average of the two tabular probabilities as an approximation.",
            project_key,
        )
        lstm_prob = (rf_prob + xgb_prob) / 2.0

    meta_learner = joblib.load(ARTIFACTS_DIR / "meta_learner.joblib")
    X_meta = np.array([[rf_prob, xgb_prob, lstm_prob]])
    meta_prob = float(meta_learner.predict_proba(X_meta)[:, 1][0])
    risk_tier = probability_to_risk_tier(meta_prob)

    _persist_live_score(
        project_key=project_key, risk_tier=risk_tier, meta_prob=meta_prob,
        rf_prob=rf_prob, xgb_prob=xgb_prob, lstm_prob=lstm_prob,
        shap_top_features=shap_top_features,
        status_observed=status_observed, percent_complete=percent_complete,
        amount_spent=amount_spent, observed_at=observed_at,
    )

    return LiveScoreResult(
        project_key=project_key, found=True, risk_tier=risk_tier, meta_prob=meta_prob,
        random_forest_prob=rf_prob, xgboost_prob=xgb_prob, lstm_prob=lstm_prob,
        shap_top_features=shap_top_features,
        message="Re-scored successfully.",
    )


def _persist_live_score(**fields) -> None:
    """Appends/updates this project's latest live score in a small local
    JSON store. In a full deployment, this function (or a caller of
    score_project) would also PATCH the project's row in Supabase's
    `projects` table via the service-role key, so the Next.js frontend's
    Manager/Inspector portals see the refreshed risk_tier immediately --
    see main.py's module docstring for why that call is optional/
    best-effort here rather than a hard dependency of this module."""
    ARTIFACTS_DIR.mkdir(parents=True, exist_ok=True)
    store: dict = {}
    if LIVE_SCORES_PATH.exists():
        store = json.loads(LIVE_SCORES_PATH.read_text())

    project_key = fields.pop("project_key")
    observed_at = fields.pop("observed_at")
    store[project_key] = {**fields, "observed_at": observed_at.isoformat(), "updated_at": datetime.utcnow().isoformat()}

    LIVE_SCORES_PATH.write_text(json.dumps(store, indent=2, default=str))
    logger.info("Persisted live score for %s to %s", project_key, LIVE_SCORES_PATH)
