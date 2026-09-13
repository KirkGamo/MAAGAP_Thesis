"""
MAAGAP — Level 0 delay-magnitude regressors (Objective 2's MAE requirement)
================================================================================
Trains Random Forest and XGBoost REGRESSORS on the same 70/30 split, the same
folds and the same leakage-guarded feature matrix as train_trees.py, and
reports Mean Absolute Error in DAYS.

WHY THIS EXISTS
------------------------------------------------------------------------------
Objective 2 commits to "standard classification and regression metrics ...
alongside Mean Absolute Error (MAE) to quantify the average prediction error in
terms of project delays". Chapter 3 nominates a continuous companion to RedFlag
for exactly this purpose. Every classification metric was computed; MAE never
was, because no regression head existed. This module is that head.

The target is delay magnitude in days:

    delay_days = T_actual_days - T_standard_days

Days, not the NegativeSlippage_pct percentage, because Chapter 3's own
justification for choosing MAE is that it "measures average prediction error in
original units ... making it interpretable for government stakeholders". A PPDO
manager reasons in days late, not in percent of standard duration.

THE CLAMPED-ROW EXCLUSION — the decision that most affects the headline number
------------------------------------------------------------------------------
1,159 rows of the labeled population (836 train / 323 test) carry
`completion_date_is_clamped=True`. For these, the Phase 8 clamp pinned T_actual
to `D_start + 1 day` because the Phase 7 lag correction had pushed the recovered
proxy completion date back before the project's own start. Their delay magnitude
is therefore a construction artifact, not an observation: T_actual is a constant
by mechanism.

Left in, they do not merely add noise — they systematically deflate the target.
Measured on this split:

    labeled population, clamped INCLUDED : mean 139 d, median  13 d
    labeled population, clamped EXCLUDED : mean 234 d, median 137 d

An MAE computed over the first population would look far better than the model
deserves, and could not be defended once a panelist asked what T_actual means
for a clamped row. The headline MAE is therefore computed with clamped rows
EXCLUDED. The clamped-included figure is still computed and reported alongside
it, so the effect of the exclusion is auditable rather than asserted.

THE PROXY-DATE CAVEAT — why another population is reported
------------------------------------------------------------------------------
Roughly 92-94% of the labeled population relies on a proxy completion date
(Phase 6/7). A binary label absorbs proxy error whenever that error is smaller
than the distance to the T_standard threshold; a continuous error metric in days
does not absorb it at all — it reports it. MAE is therefore also reported for
the directly-observed-date subpopulation alone.

Read that number with its own caveat, which cuts both ways: the direct-date
subpopulation is small (181 train / 91 test) AND distributed differently — mean
delay -136 d on test, i.e. finishing well inside T_standard, against +250 d for
the clamped-excluded population as a whole. Projects carrying a directly
recorded completion date are not a random sample of the portfolio; they are
disproportionately the well-administered ones. Neither population is "the true"
MAE. Both are reported, with n, and neither is presented alone.

A CONSTANT-PREDICTOR BASELINE IS REPORTED ALONGSIDE EVERY MAE
------------------------------------------------------------------------------
An MAE in days means nothing on its own — 90 days could be excellent or useless
depending on the spread of the target. Every MAE here is therefore accompanied
by the MAE of a constant predictor that always returns the TRAIN median delay,
and by skill = 1 - MAE_model / MAE_baseline. The median is used rather than the
mean because the median is the constant that MINIMIZES MAE, making this the
strongest constant baseline rather than a convenient one. A model that cannot
beat it is not forecasting, and this makes that visible instead of leaving it
for a panelist to discover.

Outputs
-------
    ml-service/artifacts/random_forest_regressor.joblib
    ml-service/artifacts/xgboost_regressor.joblib
    ml-service/artifacts/regression_metrics.json
    ml-service/artifacts/regression_test_predictions.csv

Usage
-----
    python models/train_regressors.py --train-csv ../data/ready/train.csv
        --test-csv ../data/ready/test.csv --artifacts-dir artifacts
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
from sklearn.ensemble import RandomForestRegressor
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.model_selection import KFold
from xgboost import XGBRegressor

sys.path.insert(0, str(Path(__file__).resolve().parent))

from train_trees import (  # noqa: E402
    N_CV_FOLDS,
    RANDOM_SEED,
    build_feature_matrix,
    drop_zero_variance_features,
)

logger = logging.getLogger("maagap.train_regressors")
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)

TARGET = "delay_days"


def build_target(df: pd.DataFrame) -> pd.Series:
    """delay_days = T_actual_days - T_standard_days. Positive means the project
    ran past its Chapter 1 standard duration; negative means it finished inside
    it."""
    missing = [c for c in ("T_actual_days", "T_standard_days") if c not in df.columns]
    if missing:
        raise ValueError(
            f"Cannot build the regression target: {missing} absent. Was this CSV "
            "produced by feature_engineering.py?"
        )
    return df["T_actual_days"] - df["T_standard_days"]


def _bool_col(df: pd.DataFrame, name: str) -> pd.Series:
    """A missing provenance flag reads as False, matching how the rest of the
    pipeline treats these columns."""
    if name not in df.columns:
        return pd.Series(False, index=df.index)
    return df[name].fillna(False).astype(bool)


def select_population(df: pd.DataFrame, exclude_clamped: bool) -> pd.DataFrame:
    """Labeled rows carrying a usable delay magnitude, optionally minus the
    Phase 8 clamped rows whose T_actual is pinned by construction."""
    out = df[df["RedFlag"].notna()].copy()
    out[TARGET] = build_target(out)
    out = out[out[TARGET].notna()]
    if exclude_clamped:
        out = out[~_bool_col(out, "completion_date_is_clamped")]
    return out


def build_design_matrix(
    df: pd.DataFrame, keep_columns: Optional[list[str]] = None
) -> tuple[pd.DataFrame, list[str]]:
    """
    train_trees.build_feature_matrix() keeps every numeric column that is not
    explicitly denylisted in its EXCLUDE_COLS. `delay_days` is computed and
    attached by select_population(), so it is numeric, not denylisted, and was
    silently admitted as a feature — the model then "predicted" the target by
    reading it (MAE 0.91 days, R2 0.9994, target importance 0.9996).

    This wrapper drops the target before delegating, and asserts it did not
    survive. The assertion is the part that matters: the denylist approach fails
    open, so any future derived column added to these frames would leak the same
    way without it.
    """
    X, cols = build_feature_matrix(df.drop(columns=[TARGET], errors="ignore"), keep_columns)
    if TARGET in cols:
        raise AssertionError(
            f"{TARGET} reached the design matrix — the regression target cannot be "
            "one of its own features."
        )
    return X, cols


def evaluate(y_true: np.ndarray, y_pred: np.ndarray, baseline_value: float, label: str) -> dict:
    """MAE is the objective's named metric; RMSE and R2 support it, and the
    constant-predictor baseline is what makes the MAE interpretable."""
    if len(y_true) == 0:
        logger.warning("%s: empty population, no metrics computed.", label)
        return {"n": 0, "mae_days": None}

    baseline_pred = np.full(len(y_true), fill_value=baseline_value, dtype=float)
    mae = float(mean_absolute_error(y_true, y_pred))
    mae_baseline = float(mean_absolute_error(y_true, baseline_pred))
    metrics = {
        "n": int(len(y_true)),
        "mae_days": round(mae, 2),
        "rmse_days": round(float(np.sqrt(mean_squared_error(y_true, y_pred))), 2),
        "r2": round(float(r2_score(y_true, y_pred)), 4) if len(y_true) > 1 else None,
        "baseline_mae_days": round(mae_baseline, 2),
        "skill_vs_baseline": round(1.0 - mae / mae_baseline, 4) if mae_baseline > 0 else None,
        "mean_observed_delay_days": round(float(np.mean(y_true)), 1),
    }
    logger.info("%s: %s", label, metrics)
    return metrics


def generate_oof_predictions(
    model_factory, X: pd.DataFrame, y: np.ndarray, n_splits: int, seed: int
) -> np.ndarray:
    """Plain KFold, not StratifiedKFold — the target is continuous. Same fold
    count and seed as train_trees.py so the two heads stay comparable."""
    oof = np.zeros(len(y), dtype=float)
    kf = KFold(n_splits=n_splits, shuffle=True, random_state=seed)
    for fold_i, (train_idx, val_idx) in enumerate(kf.split(X)):
        model = model_factory()
        model.fit(X.iloc[train_idx], y[train_idx])
        oof[val_idx] = model.predict(X.iloc[val_idx])
        logger.info(
            "  fold %d/%d: trained on %d rows, predicted %d OOF rows",
            fold_i + 1, n_splits, len(train_idx), len(val_idx),
        )
    return oof


def run(
    train_csv: Path,
    test_csv: Path,
    artifacts_dir: Path,
    n_splits: int = N_CV_FOLDS,
    seed: int = RANDOM_SEED,
) -> dict:
    for p in (train_csv, test_csv):
        if not p.exists():
            raise FileNotFoundError(f"Required input not found: {p}")
    artifacts_dir.mkdir(parents=True, exist_ok=True)

    train_raw = pd.read_csv(train_csv, low_memory=False)
    test_raw = pd.read_csv(test_csv, low_memory=False)

    # --- headline population: clamped rows excluded (see module docstring) ---
    train_df = select_population(train_raw, exclude_clamped=True)
    test_df = select_population(test_raw, exclude_clamped=True)

    n_clamped_train = int(_bool_col(select_population(train_raw, False), "completion_date_is_clamped").sum())
    n_clamped_test = int(_bool_col(select_population(test_raw, False), "completion_date_is_clamped").sum())
    logger.warning(
        "CLAMPED-ROW EXCLUSION: dropped %d train / %d test rows whose T_actual is pinned "
        "to D_start+1 by the Phase 8 clamp. Headline MAE is computed WITHOUT them; the "
        "clamped-included figure is reported alongside for audit.",
        n_clamped_train, n_clamped_test,
    )
    logger.warning(
        "Regression population: %d train / %d test rows (delay_days mean %.1f / %.1f).",
        len(train_df), len(test_df), train_df[TARGET].mean(), test_df[TARGET].mean(),
    )

    y_train = train_df[TARGET].to_numpy(dtype=float)
    y_test = test_df[TARGET].to_numpy(dtype=float)

    X_train_full, _ = build_design_matrix(train_df)
    keep = drop_zero_variance_features(X_train_full)
    X_train = X_train_full[keep]
    X_test, _ = build_design_matrix(test_df, keep_columns=keep)

    baseline_value = float(np.median(y_train))
    logger.warning(
        "Constant-predictor baseline = train median delay = %.1f days. Every MAE below is "
        "reported against it; a model that cannot beat it is not forecasting.",
        baseline_value,
    )

    factories = {
        "random_forest_regressor": lambda: RandomForestRegressor(
            n_estimators=300, random_state=seed, n_jobs=-1, min_samples_leaf=2,
        ),
        "xgboost_regressor": lambda: XGBRegressor(
            n_estimators=400, learning_rate=0.05, max_depth=6,
            subsample=0.8, colsample_bytree=0.8,
            random_state=seed, n_jobs=-1, objective="reg:absoluteerror",
        ),
    }

    metrics: dict = {
        "target": "delay_days = T_actual_days - T_standard_days",
        "units": "days",
        "n_train": len(train_df),
        "n_test": len(test_df),
        "n_features": len(keep),
        "clamped_rows_excluded": {"train": n_clamped_train, "test": n_clamped_test},
        "baseline": {
            "description": "constant predictor returning the train-median delay",
            "value_days": round(baseline_value, 1),
        },
        "models": {},
    }

    project_keys = (
        test_df["project_key"].to_numpy()
        if "project_key" in test_df.columns
        else np.arange(len(test_df))
    )
    predictions = pd.DataFrame({
        "project_key": project_keys,
        "y_true_delay_days": y_test,
        "completion_date_is_proxy": _bool_col(test_df, "completion_date_is_proxy").to_numpy(),
    })

    direct_mask = ~_bool_col(test_df, "completion_date_is_proxy").to_numpy()

    # Clamped-INCLUDED contrast set, so the exclusion's effect is measurable
    # rather than merely asserted in the docstring.
    test_incl = select_population(test_raw, exclude_clamped=False)
    y_test_incl = test_incl[TARGET].to_numpy(dtype=float)
    X_test_incl, _ = build_design_matrix(test_incl, keep_columns=keep)

    for name, factory in factories.items():
        logger.warning("Training %s ...", name)
        oof = generate_oof_predictions(factory, X_train, y_train, n_splits, seed)
        model = factory()
        model.fit(X_train, y_train)
        pred_test = model.predict(X_test)
        predictions[f"{name}_pred_delay_days"] = pred_test

        metrics["models"][name] = {
            "oof_metrics": evaluate(y_train, oof, baseline_value, f"{name} OOF"),
            "test_metrics": evaluate(
                y_test, pred_test, baseline_value,
                f"{name} TEST (headline, clamped excluded)",
            ),
            "test_metrics_direct_dates_only": evaluate(
                y_test[direct_mask], pred_test[direct_mask], baseline_value,
                f"{name} TEST (directly-observed completion dates only)",
            ),
            "test_metrics_clamped_included": evaluate(
                y_test_incl, model.predict(X_test_incl), baseline_value,
                f"{name} TEST (clamped INCLUDED — contrast, not the headline)",
            ),
        }
        joblib.dump(model, artifacts_dir / f"{name}.joblib")
        logger.info("Saved %s", artifacts_dir / f"{name}.joblib")

    (artifacts_dir / "regression_metrics.json").write_text(
        json.dumps(metrics, indent=2), encoding="utf-8"
    )
    predictions.to_csv(artifacts_dir / "regression_test_predictions.csv", index=False)
    logger.warning("Wrote %s", artifacts_dir / "regression_metrics.json")

    best_name, best = min(
        metrics["models"].items(), key=lambda kv: kv[1]["test_metrics"]["mae_days"]
    )
    logger.warning(
        "OBJECTIVE 2 HEADLINE — best test MAE: %s at %.2f days (constant-predictor "
        "baseline %.2f days, skill %.1f%%), n=%d.",
        best_name,
        best["test_metrics"]["mae_days"],
        best["test_metrics"]["baseline_mae_days"],
        100 * (best["test_metrics"]["skill_vs_baseline"] or 0),
        best["test_metrics"]["n"],
    )
    return metrics


def parse_args(argv: Optional[list[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--train-csv", type=Path, default=Path("../../data/ready/train.csv"))
    parser.add_argument("--test-csv", type=Path, default=Path("../../data/ready/test.csv"))
    parser.add_argument("--artifacts-dir", type=Path, default=Path("../artifacts"))
    parser.add_argument("--cv-folds", type=int, default=N_CV_FOLDS)
    parser.add_argument("--seed", type=int, default=RANDOM_SEED)
    return parser.parse_args(argv)


def main(argv: Optional[list[str]] = None) -> int:
    args = parse_args(argv)
    run(args.train_csv, args.test_csv, args.artifacts_dir, args.cv_folds, args.seed)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
