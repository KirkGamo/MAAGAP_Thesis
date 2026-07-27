"""
MAAGAP Level 0 Base Learner — LSTM (Sequential/Temporal)
================================================================================
Trains the LSTM base learner specified in Chapter 3 on the per-project event
sequences in data/ready/lstm_sequences.npy (release -> liquidation ->
monitoring-visit, produced by feature_engineering.py Step 10), evaluated on
the held-out sequences whose project_key falls in data/ready/test.csv.

Like train_trees.py, this generates Out-Of-Fold (OOF) predictions via
cross-validation on the training sequences — required so the Level 1
meta-learner is trained on unbiased base-learner signal rather than each
model's optimistic in-sample fit.

CRITICAL CONTEXT — read before interpreting these results: Phase 6's
universal proxy-completion-date recovery (feature_engineering.py) grew the
labeled sequence population from 97 (64 train / 33 test, 3 / 2 positive —
the original Phase 3 baseline) to roughly 2,000 (1,407 train / 596 test).
This is a real increase in usable history, not a statistical artifact — but
see feature_engineering.py's and train_trees.py's module docstrings for the
Phase 6 proxy-date caveat: rows whose completion date was recovered via
proxy (the latest recorded monitoring visit or liquidation submission for
that project) show a substantially higher RedFlag rate than directly-
observed rows, because the proxy date is a systematically LATE upper bound
on true completion. That bias applies to this LSTM's training population
exactly as it does to the tabular learners' — treat the headline metrics
below with that caveat in mind, not as free of it just because the sample
size grew.

The `--epochs`/`--batch-size`/`--cv-folds` CLI flags (see `parse_args`)
let this run at a smaller epoch count and larger batch size than the
original Phase 3 defaults (60 epochs, batch size 8, 5 folds) when the much
larger Phase 6 training set makes a full run impractically slow in a
resource-constrained environment; the module-level EPOCHS/BATCH_SIZE/
N_CV_FOLDS_DEFAULT constants remain the intended defaults for an
unconstrained run.

Padding note: padding timesteps in the sequence tensors are filled with -1
(not 0), since event_type=0 is a legitimate real value (a fund-release
event) — see feature_engineering.py's assemble_lstm_sequences docstring.
Keras's Masking(mask_value=-1.0) layer relies on this to skip padding
correctly.

Usage:
    python train_lstm.py \
        --sequences ../../data/ready/lstm_sequences.npy \
        --mask ../../data/ready/lstm_sequence_mask.npy \
        --project-keys ../../data/ready/lstm_project_keys.json \
        --train-csv ../../data/ready/train.csv \
        --test-csv ../../data/ready/test.csv \
        --artifacts-dir ../artifacts

Requires: numpy, pandas, scikit-learn, tensorflow (see ml-service/requirements.txt)
================================================================================
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
from pathlib import Path
from typing import Optional

os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "3")  # silence TF's C++ INFO/WARNING banner noise

import numpy as np
import pandas as pd
from sklearn.metrics import (
    accuracy_score, f1_score, precision_score, recall_score, roc_auc_score,
)
from sklearn.model_selection import StratifiedKFold

logger = logging.getLogger("maagap.train_lstm")
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)

RANDOM_SEED = 42
N_CV_FOLDS_DEFAULT = 5
PAD_VALUE = -1.0
EPOCHS = 60
BATCH_SIZE = 8


def load_labels(project_keys: list[str], train_csv: Path, test_csv: Path) -> tuple[np.ndarray, np.ndarray]:
    """
    Matches each project_key in the sequence tensor against train.csv/test.csv
    to (a) obtain its RedFlag label and (b) determine whether it belongs to
    the train or test split — reusing the SAME project-level split as the
    tabular base learners, so all Level 0 models are evaluated on identical
    train/test partitions ahead of Level 1 meta-learner training.
    """
    train_df = pd.read_csv(train_csv, usecols=["project_key", "RedFlag"])
    test_df = pd.read_csv(test_csv, usecols=["project_key", "RedFlag"])
    label_map = dict(zip(pd.concat([train_df, test_df])["project_key"], pd.concat([train_df, test_df])["RedFlag"]))
    train_keys = set(train_df["project_key"])
    test_keys = set(test_df["project_key"])

    split = np.array(["none"] * len(project_keys), dtype=object)
    labels = np.full(len(project_keys), np.nan)
    for i, k in enumerate(project_keys):
        if k in label_map:
            labels[i] = label_map[k]
        split[i] = "train" if k in train_keys else ("test" if k in test_keys else "none")
    return labels, split


def fit_sequence_scaler(sequences: np.ndarray, mask: np.ndarray) -> dict:
    """
    Computes per-feature min/max over REAL (non-padding) timesteps only,
    fit on the sequences passed in (must be the TRAIN subset). Padding
    values (-1 sentinel) must be excluded from the fit or they would corrupt
    the scale, especially for the event_type feature which legitimately
    ranges 0-2.
    """
    params = {}
    for feat_i in range(sequences.shape[2]):
        real_values = sequences[:, :, feat_i][mask]
        col_min = float(real_values.min()) if real_values.size else 0.0
        col_max = float(real_values.max()) if real_values.size else 1.0
        params[str(feat_i)] = {"min": col_min, "max": col_max}
    return params


def apply_sequence_scaler(sequences: np.ndarray, mask: np.ndarray, params: dict) -> np.ndarray:
    """Scales real timesteps to [0, 1] per feature; padding stays at PAD_VALUE so Masking still works."""
    scaled = sequences.copy()
    for feat_i_str, p in params.items():
        feat_i = int(feat_i_str)
        denom = (p["max"] - p["min"]) or 1.0
        col = scaled[:, :, feat_i]
        real = mask
        col[real] = np.clip((col[real] - p["min"]) / denom, 0, 1)
        scaled[:, :, feat_i] = col
    # Re-assert the padding sentinel in case any padding cell drifted during
    # the vectorized update above (it shouldn't, since `mask` excludes it, but
    # this keeps the invariant explicit and cheap to verify).
    scaled[~mask[:, :, None].repeat(sequences.shape[2], axis=2)] = PAD_VALUE
    return scaled


def build_lstm_model(n_timesteps: int, n_features: int, lstm_units: int = 32, seed: int = RANDOM_SEED):
    """
    Small, heavily-regularized LSTM: one recurrent layer with dropout AND
    recurrent_dropout, followed by a small dense head with its own dropout.
    Deliberately shallow/narrow given the tiny labeled sample (Chapter 3
    calls for LSTM depth to capture temporal dependencies, but an
    over-parameterized network here would simply memorize 64 sequences).
    """
    import tensorflow as tf
    from tensorflow import keras
    from tensorflow.keras import layers

    tf.random.set_seed(seed)
    model = keras.Sequential([
        layers.Input(shape=(n_timesteps, n_features)),
        layers.Masking(mask_value=PAD_VALUE),
        layers.LSTM(lstm_units, dropout=0.2, recurrent_dropout=0.2),
        layers.Dense(16, activation="relu"),
        layers.Dropout(0.3),
        layers.Dense(1, activation="sigmoid"),
    ])
    model.compile(
        optimizer=keras.optimizers.Adam(learning_rate=1e-3),
        loss="binary_crossentropy",
        metrics=[keras.metrics.AUC(name="auc"), "accuracy"],
    )
    return model


def generate_oof_predictions(
    X: np.ndarray, y: np.ndarray, n_splits: int, seed: int = RANDOM_SEED,
    epochs: int = EPOCHS, batch_size: int = BATCH_SIZE,
) -> np.ndarray:
    """
    OOF predictions via StratifiedKFold. `n_splits` is expected to already
    have been reduced (by the caller) to at most the minority class count,
    since scikit-learn requires every fold to be able to contain at least
    one minority example.
    """
    oof = np.zeros(len(y), dtype=float)
    skf = StratifiedKFold(n_splits=n_splits, shuffle=True, random_state=seed)
    for fold_i, (train_idx, val_idx) in enumerate(skf.split(X, y)):
        class_weight = compute_class_weight(y[train_idx])
        model = build_lstm_model(X.shape[1], X.shape[2], seed=seed + fold_i)
        model.fit(
            X[train_idx], y[train_idx],
            epochs=epochs, batch_size=batch_size, verbose=0,
            class_weight=class_weight,
        )
        oof[val_idx] = model.predict(X[val_idx], verbose=0).ravel()
        logger.info("  fold %d/%d: trained on %d sequences, predicted %d OOF sequences", fold_i + 1, n_splits, len(train_idx), len(val_idx))
    return oof


def compute_class_weight(y: np.ndarray) -> dict:
    n_pos, n_neg = int(y.sum()), int((y == 0).sum())
    total = n_pos + n_neg
    if n_pos == 0 or n_neg == 0:
        return {0: 1.0, 1: 1.0}
    return {0: total / (2.0 * n_neg), 1: total / (2.0 * n_pos)}


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


def run(
    sequences_path: Path, mask_path: Path, project_keys_path: Path,
    train_csv: Path, test_csv: Path, artifacts_dir: Path,
    n_splits_requested: int = N_CV_FOLDS_DEFAULT, seed: int = RANDOM_SEED,
    epochs: int = EPOCHS, batch_size: int = BATCH_SIZE,
) -> dict:
    for p in (sequences_path, mask_path, project_keys_path, train_csv, test_csv):
        if not p.exists():
            raise FileNotFoundError(f"Required input not found: {p}")
    artifacts_dir.mkdir(parents=True, exist_ok=True)

    sequences = np.load(sequences_path)
    mask = np.load(mask_path)
    project_keys = json.load(open(project_keys_path))
    if len(sequences) == 0:
        raise ValueError(f"{sequences_path} contains zero sequences — nothing to train on.")

    labels, split = load_labels(project_keys, train_csv, test_csv)
    has_label = ~np.isnan(labels)
    train_mask = has_label & (split == "train")
    test_mask = has_label & (split == "test")

    X_train, y_train = sequences[train_mask], labels[train_mask].astype(int)
    X_test, y_test = sequences[test_mask], labels[test_mask].astype(int)
    seq_mask_train, seq_mask_test = mask[train_mask], mask[test_mask]

    logger.warning(
        "Training on %d sequences (%d positive) / testing on %d sequences (%d positive). "
        "See module docstring — this is a very small sample for a recurrent architecture.",
        len(X_train), int(y_train.sum()), len(X_test), int(y_test.sum()),
    )

    n_pos_train = int(y_train.sum())
    n_splits = min(n_splits_requested, max(n_pos_train, 2))
    if n_splits < n_splits_requested:
        logger.warning(
            "Reducing CV folds from %d to %d: only %d positive sequence(s) in the training set, "
            "and stratified CV needs at least one positive example per fold.",
            n_splits_requested, n_splits, n_pos_train,
        )

    scaler_params = fit_sequence_scaler(X_train, seq_mask_train)
    X_train_scaled = apply_sequence_scaler(X_train, seq_mask_train, scaler_params)
    X_test_scaled = apply_sequence_scaler(X_test, seq_mask_test, scaler_params)

    logger.info("Generating OOF predictions via %d-fold stratified CV (epochs=%d, batch_size=%d)", n_splits, epochs, batch_size)
    oof_probs = generate_oof_predictions(X_train_scaled, y_train, n_splits=n_splits, seed=seed, epochs=epochs, batch_size=batch_size)
    oof_metrics = evaluate(y_train, oof_probs, "lstm (OOF, train)")

    logger.info("Training final LSTM on the full training set")
    final_model = build_lstm_model(X_train_scaled.shape[1], X_train_scaled.shape[2], seed=seed)
    final_model.fit(
        X_train_scaled, y_train, epochs=epochs, batch_size=batch_size, verbose=0,
        class_weight=compute_class_weight(y_train),
    )
    test_probs = final_model.predict(X_test_scaled, verbose=0).ravel()
    test_metrics = evaluate(y_test, test_probs, "lstm (test)")

    model_path = artifacts_dir / "lstm_model.keras"
    final_model.save(model_path)
    logger.info("Saved LSTM model to %s", model_path)

    train_keys_arr = np.array(project_keys, dtype=object)[train_mask]
    test_keys_arr = np.array(project_keys, dtype=object)[test_mask]
    pd.DataFrame({"project_key": train_keys_arr, "y_true": y_train, "lstm_oof_prob": oof_probs}).to_csv(
        artifacts_dir / "oof_predictions_lstm.csv", index=False
    )
    pd.DataFrame({"project_key": test_keys_arr, "y_true": y_test, "lstm_test_prob": test_probs}).to_csv(
        artifacts_dir / "test_predictions_lstm.csv", index=False
    )
    with open(artifacts_dir / "lstm_sequence_scaler.json", "w") as f:
        json.dump(scaler_params, f, indent=2)

    results = {
        "n_train": len(X_train), "n_test": len(X_test),
        "n_train_positive": int(y_train.sum()), "n_test_positive": int(y_test.sum()),
        "n_cv_folds_used": n_splits,
        "oof_metrics": oof_metrics, "test_metrics": test_metrics,
    }
    with open(artifacts_dir / "lstm_model_metrics.json", "w") as f:
        json.dump(results, f, indent=2)

    logger.info("Artifacts written to %s", artifacts_dir.resolve())
    return results


def parse_args(argv: Optional[list[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Train the MAAGAP Level 0 LSTM base learner.")
    parser.add_argument("--sequences", type=Path, default=Path("../../data/ready/lstm_sequences.npy"))
    parser.add_argument("--mask", type=Path, default=Path("../../data/ready/lstm_sequence_mask.npy"))
    parser.add_argument("--project-keys", type=Path, default=Path("../../data/ready/lstm_project_keys.json"))
    parser.add_argument("--train-csv", type=Path, default=Path("../../data/ready/train.csv"))
    parser.add_argument("--test-csv", type=Path, default=Path("../../data/ready/test.csv"))
    parser.add_argument("--artifacts-dir", type=Path, default=Path("../artifacts"))
    parser.add_argument("--cv-folds", type=int, default=N_CV_FOLDS_DEFAULT)
    parser.add_argument("--seed", type=int, default=RANDOM_SEED)
    parser.add_argument("--epochs", type=int, default=EPOCHS,
                         help=f"Training epochs per fold/final fit (default {EPOCHS}). "
                              "Lower for a faster run on a much larger post-Phase-6 training set.")
    parser.add_argument("--batch-size", type=int, default=BATCH_SIZE,
                         help=f"Training batch size (default {BATCH_SIZE}). Larger batches are "
                              "reasonable now that the training set is in the thousands, not 64 sequences.")
    return parser.parse_args(argv)


def main(argv: Optional[list[str]] = None) -> int:
    args = parse_args(argv)
    try:
        run(
            args.sequences, args.mask, args.project_keys, args.train_csv, args.test_csv,
            args.artifacts_dir, args.cv_folds, args.seed, args.epochs, args.batch_size,
        )
    except (FileNotFoundError, ValueError) as exc:
        logger.error("Aborted: %s", exc)
        return 1
    except Exception:
        logger.exception("LSTM training failed with an unexpected error.")
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
