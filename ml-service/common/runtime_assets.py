"""
MAAGAP — runtime asset verification (D1)
================================================================================
Checks at startup that the model artifacts and prepared data this service needs
are actually present, and refuses to start when a required one is not.

WHY THIS EXISTS
------------------------------------------------------------------------------
`ml-service/artifacts/` and `data/ready/` are both gitignored, correctly: they
hold model binaries and derived data, not source. The consequence is that a
container built from a git clone contains neither. Such a container imports
cleanly, answers GET /health with {"status": "ok"}, passes whatever readiness
probe the platform runs -- and then raises FileNotFoundError on the first real
request, from deep inside joblib.load().

That is the same failure shape this codebase has been bitten by repeatedly: a
missing input degrading into something that looks like success. S1 was an unset
secret silently disabling authentication. The live-scoring bug was an absent
LSTM sequence silently becoming a fabricated one. The rule that fixed both is
the rule applied here -- a missing required input is a refusal to start, stated
once, naming the file and how to produce it.

TWO TIERS, DELIBERATELY
------------------------------------------------------------------------------
REQUIRED means the service cannot perform its primary function (score a
project) without it. Absent -> RuntimeError at import, before the port opens.

DEGRADED means a specific feature stops working while scoring still succeeds.
Absent -> a warning that names which feature, because a deployer reading
"train.csv missing" cannot be expected to know that it means the SHAP
breakdown will 500 while everything else looks fine.

The artifacts directory is also checked for WRITABILITY, not just existence.
The service writes live_scores.json, optimizer_run_status.json and
inspector_schedule.csv there at runtime, so a correctly-populated but
read-only mount -- the predictable result of COPYing artifacts in as root and
then dropping to a non-root user -- would otherwise surface as a failed field
report rather than as a deployment mistake.
"""

from __future__ import annotations

import logging
import os
from pathlib import Path

logger = logging.getLogger("maagap.runtime_assets")

from common.paths import (
    ARTIFACTS_DIR,
    DATA_READY_DIR,
    ML_SERVICE_DIR,
    OUTPUT_DIR,
    REPO_ROOT,
    output_dir_is_separate,
)

# How to regenerate each family of inputs, so the error message is actionable
# rather than merely accurate.
_TRAIN_TREES = "python models/train_trees.py"
_TRAIN_LSTM = "python models/train_lstm.py"
_TRAIN_META = "python models/train_meta_learner.py"
_FEATURES = "python data_pipeline/feature_engineering.py"

# (path, what produces it) -- absent means this service cannot score.
REQUIRED: tuple[tuple[Path, str], ...] = (
    (ARTIFACTS_DIR / "tabular_feature_columns.json", _TRAIN_TREES),
    (ARTIFACTS_DIR / "random_forest.joblib", _TRAIN_TREES),
    (ARTIFACTS_DIR / "xgboost.joblib", _TRAIN_TREES),
    (ARTIFACTS_DIR / "lstm_model.keras", _TRAIN_LSTM),
    (ARTIFACTS_DIR / "lstm_sequence_scaler.json", _TRAIN_LSTM),
    (ARTIFACTS_DIR / "meta_learner.joblib", _TRAIN_META),
    # D21's two-learner model. Required, not optional: 72% of projects have no
    # LSTM sequence, so without it the majority of live re-scores raise rather
    # than fabricating an LSTM probability to work around its absence.
    (ARTIFACTS_DIR / "meta_learner_two.joblib", _TRAIN_META),
    (DATA_READY_DIR / "inference.csv", _FEATURES),
    (DATA_READY_DIR / "scaler_params.json", _FEATURES),
    (DATA_READY_DIR / "lstm_inference_project_keys.json", _FEATURES),
    (DATA_READY_DIR / "lstm_inference_sequences.npy", _FEATURES),
    (DATA_READY_DIR / "lstm_inference_sequence_mask.npy", _FEATURES),
)

# (path, which feature breaks when it is absent) -- the service still scores.
DEGRADED: tuple[tuple[Path, str], ...] = (
    (
        DATA_READY_DIR / "train.csv",
        "SHAP explanations: the risk-breakdown panel needs this as its "
        "background distribution and will fail without it",
    ),
    (
        DATA_READY_DIR / "test.csv",
        "resolved-project detection: an already-finished project will report "
        "'not_found' instead of 'resolved'",
    ),
    (
        ARTIFACTS_DIR / "tree_models_metrics.json",
        "the Models tab: /api/v1/model-metrics returns 404 without at least "
        "one metrics file",
    ),
    (
        ARTIFACTS_DIR / "lstm_model_metrics.json",
        "the Models tab's LSTM panel",
    ),
    (
        ARTIFACTS_DIR / "meta_learner_metrics.json",
        "the Models tab's ensemble metrics",
    ),
    (
        ARTIFACTS_DIR / "meta_learner_test_predictions.csv",
        "the confusion matrix, which is recomputed from this file",
    ),
    (
        ARTIFACTS_DIR / "regression_metrics.json",
        "the delay-magnitude MAE (Objective 2's regression half)",
    ),
)


def _relative(path: Path) -> str:
    """Repo-relative where possible, so the message reads the same locally and
    in a container regardless of where the tree is mounted."""
    try:
        return str(path.relative_to(REPO_ROOT))
    except ValueError:
        return str(path)


def verify_runtime_assets(*, strict: bool = True) -> list[str]:
    """Verify the model artifacts and prepared data are present and usable.

    Raises RuntimeError naming every missing required input when `strict`.
    Returns the list of degraded-feature warnings (also logged), so a caller
    that wants to surface them elsewhere can.

    `strict=False` exists for the pipeline scripts, which legitimately run
    against a tree where these files do not exist yet -- that is what they are
    there to produce.
    """
    missing_required = [(p, fix) for p, fix in REQUIRED if not p.exists()]

    if missing_required and strict:
        # Group by the command that produces them: a deployer with eight
        # missing files needs to know they come from three scripts, not eight.
        by_fix: dict[str, list[Path]] = {}
        for path, fix in missing_required:
            by_fix.setdefault(fix, []).append(path)

        lines = [
            f"ml-service cannot start: {len(missing_required)} required model "
            "artifact(s)/data file(s) are missing.",
            "",
            "This service scores projects from trained models. Both "
            "ml-service/artifacts/ and data/ready/ are gitignored (they hold "
            "model binaries and derived data, not source), so a container or "
            "checkout that has not been given them cannot score anything.",
            "",
        ]
        for fix, paths in by_fix.items():
            lines.append(f"  Produced by `{fix}`:")
            lines.extend(f"    - {_relative(p)}" for p in paths)
        lines += [
            "",
            "In a deployed container these are baked into the image at build "
            "time (see ml-service/Dockerfile). If this is a fresh container, "
            "the build did not copy them -- check the COPY lines and that the "
            "build context is the repository root, not ml-service/.",
        ]
        raise RuntimeError("\n".join(lines))

    warnings: list[str] = []
    for path, consequence in DEGRADED:
        if not path.exists():
            warnings.append(f"{_relative(path)} is missing — {consequence}.")

    # Writability of the OUTPUT directory, not just presence of the inputs.
    # The service writes live_scores.json, optimizer_run_status.json,
    # inspector_schedule.csv and its summary there. OUTPUT_DIR defaults to
    # artifacts/ and is a separate volume when deployed (see common/paths.py).
    if OUTPUT_DIR.exists() and not os.access(OUTPUT_DIR, os.W_OK):
        detail = (
            "In a container this usually means the mounted volume is owned by "
            "root while the service runs as the unprivileged `maagap` user."
            if output_dir_is_separate()
            else "In a container this usually means artifacts/ was copied as "
            "root and not chowned to the runtime user."
        )
        warnings.append(
            f"{_relative(OUTPUT_DIR)} is not writable by this process — live "
            "re-scores, optimizer run status and the generated schedule all "
            f"write here, so field reports and optimizer runs will fail. {detail}"
        )

    for warning in warnings:
        logger.warning(warning)

    if not missing_required and not warnings:
        logger.info(
            "Runtime assets: all %d required and %d optional file(s) present.",
            len(REQUIRED),
            len(DEGRADED),
        )
    elif not missing_required:
        logger.info(
            "Runtime assets: all %d required file(s) present, %d degraded "
            "warning(s) above.",
            len(REQUIRED),
            len(warnings),
        )

    return warnings
