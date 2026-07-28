"""
MAAGAP ML Microservice — FastAPI Entrypoint
================================================================================
Phase 8 Task 2: the real receiving endpoint for the ML feedback loop, wired
to `frontend/src/actions/submit-report.ts`'s `notifyMlService()` (that file's
module docstring describes the full intended contract this implements).

Run locally:
    uvicorn main:app --reload --port 8000

Environment variables:
    ML_SERVICE_WEBHOOK_SECRET   Shared secret checked against the
                                 `X-Webhook-Secret` header. If unset, the
                                 check is skipped with a startup warning
                                 (fine for local dev, not for a real deploy).
    SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
                                 Optional. If both are set, a successful
                                 re-score also best-effort PATCHes the
                                 project's `risk_tier`/`risk_probability`
                                 columns in Supabase so the Next.js frontend
                                 reflects it immediately. If unset, the
                                 refreshed score still persists locally to
                                 artifacts/live_scores.json and is available
                                 via GET /api/v1/live-score/{project_key} —
                                 Supabase is a nice-to-have here, not a hard
                                 dependency (see live_scoring.py's
                                 `_persist_live_score` docstring).
"""

import logging
import os
from datetime import datetime, timezone
from typing import Optional

from fastapi import BackgroundTasks, FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

from inference.live_scoring import ARTIFACTS_DIR, LIVE_SCORES_PATH, score_project

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("maagap.main")

app = FastAPI(
    title="MAAGAP ML Service",
    description=(
        "Predictive risk assessment + resource allocation microservice for "
        "PPDO Iloilo Province project management (MAAGAP thesis system)."
    ),
    version="0.8.0",
)

WEBHOOK_SECRET = os.environ.get("ML_SERVICE_WEBHOOK_SECRET")
if not WEBHOOK_SECRET:
    logger.warning(
        "ML_SERVICE_WEBHOOK_SECRET is not set — /webhooks/monitoring-report and "
        "/api/v1/update-monitoring will accept requests WITHOUT authentication. "
        "Set this env var before deploying anywhere reachable outside localhost."
    )


def _check_webhook_secret(x_webhook_secret: Optional[str]) -> None:
    if WEBHOOK_SECRET and x_webhook_secret != WEBHOOK_SECRET:
        raise HTTPException(status_code=401, detail="Invalid or missing X-Webhook-Secret header.")


class UpdateMonitoringPayload(BaseModel):
    """Matches the inspector mobile submission described in Phase 8 Task 2:
    project identity, newly observed status, optional percent complete,
    optional amount spent, and an observation timestamp."""

    project_key: str = Field(..., description="Matches projects.project_key in Supabase / the ML feature tables.")
    status_observed: str = Field(
        ..., description='One of: "completed", "on_going", "not_yet_implemented", "for_bidding".'
    )
    percent_complete: Optional[float] = Field(None, ge=0, le=100)
    amount_spent: Optional[float] = Field(None, ge=0, description="Budget spent to date, in PHP.")
    observed_at: Optional[datetime] = Field(
        None, description="Defaults to server-received time (UTC) if omitted."
    )
    photo_url: Optional[str] = Field(
        None,
        description=(
            "Phase 10, Task 4: a Supabase Storage path/URL for one of the Inspector's "
            "site photos on this visit (see monitoring_reports.photo_urls in Supabase, "
            "which is the record of truth for the full set — this webhook only ever "
            "receives one representative photo alongside the re-score signal). Not a "
            "model feature: none of RF/XGBoost/LSTM/the meta-learner consume image data, "
            "so this field does not affect risk_tier or risk_probability. It is accepted "
            "and logged/persisted (see _run_rescore below) purely so this endpoint's "
            "payload can be inspected/audited without needing a separate Supabase query, "
            "and so any future visual-evidence feature (e.g. image-based progress "
            "verification) has a place to land without another payload migration."
        ),
    )


class UpdateMonitoringResponse(BaseModel):
    accepted: bool
    project_key: str
    message: str


def _run_rescore(payload: UpdateMonitoringPayload) -> None:
    """The actual background job: re-score the one project and persist the
    result. Runs after the HTTP response has already been sent (see the
    202 Accepted pattern in the route below) so the Inspector's submission
    is never blocked on model inference."""
    observed_at = payload.observed_at or datetime.now(timezone.utc)
    try:
        result = score_project(
            project_key=payload.project_key,
            status_observed=payload.status_observed,
            observed_at=observed_at,
            percent_complete=payload.percent_complete,
            amount_spent=payload.amount_spent,
        )
    except FileNotFoundError as exc:
        logger.error("Re-score failed for %s — pipeline artifacts missing: %s", payload.project_key, exc)
        return
    except Exception:
        logger.exception("Unhandled error re-scoring project %s", payload.project_key)
        return

    if not result.found:
        logger.warning("Re-score skipped for %s: %s", payload.project_key, result.message)
        return

    logger.info(
        "Re-scored %s -> tier=%s meta_prob=%.4f (rf=%.4f xgb=%.4f lstm=%.4f)",
        payload.project_key, result.risk_tier, result.meta_prob,
        result.random_forest_prob, result.xgboost_prob, result.lstm_prob,
    )
    if payload.photo_url:
        # Not a model input (see UpdateMonitoringPayload.photo_url's
        # docstring) -- logged only, for audit visibility on this endpoint.
        # The record of truth for an Inspector's photos is Supabase's
        # monitoring_reports.photo_urls, written directly by
        # actions/submit-report.ts before this webhook ever fires.
        logger.info("Photo attached to %s's monitoring report: %s", payload.project_key, payload.photo_url)

    _maybe_patch_supabase(payload.project_key, result.risk_tier, result.meta_prob)


def _maybe_patch_supabase(project_key: str, risk_tier: Optional[str], risk_probability: Optional[float]) -> None:
    """Best-effort push of the refreshed score back into Supabase's
    `projects` table, so the Manager Portal's backlog/map views reflect it
    without waiting on a full pipeline re-run. No-ops with a log line if
    Supabase service-role credentials aren't configured — this mirrors the
    honest-placeholder pattern used elsewhere in this project (see
    submit-report.ts's docstring), except here the code path itself is
    real; only its credentials are optional."""
    url = os.environ.get("SUPABASE_URL")
    service_role_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not (url and service_role_key):
        logger.info(
            "SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY not configured — refreshed score for %s "
            "persisted locally only (see %s). Set both env vars to also push it live.",
            project_key, LIVE_SCORES_PATH,
        )
        return

    try:
        from supabase import create_client

        client = create_client(url, service_role_key)
        client.table("projects").update(
            {"risk_tier": risk_tier, "risk_probability": risk_probability}
        ).eq("project_key", project_key).execute()
        logger.info("Patched Supabase projects row for %s.", project_key)
    except Exception:
        logger.exception("Best-effort Supabase patch failed for %s (non-fatal).", project_key)


@app.post("/api/v1/update-monitoring", response_model=UpdateMonitoringResponse, status_code=202)
async def update_monitoring(
    payload: UpdateMonitoringPayload,
    background_tasks: BackgroundTasks,
    x_webhook_secret: Optional[str] = Header(None),
):
    """Accepts an inspector's field-monitoring observation and queues a
    background re-score. Returns 202 immediately — the caller (the
    Next.js Server Action) must not block on model inference."""
    _check_webhook_secret(x_webhook_secret)
    background_tasks.add_task(_run_rescore, payload)
    return UpdateMonitoringResponse(
        accepted=True, project_key=payload.project_key,
        message="Update accepted; re-scoring in background.",
    )


@app.post("/webhooks/monitoring-report", response_model=UpdateMonitoringResponse, status_code=202)
async def monitoring_report_webhook(
    payload: UpdateMonitoringPayload,
    background_tasks: BackgroundTasks,
    x_webhook_secret: Optional[str] = Header(None),
):
    """Alias of /api/v1/update-monitoring under the URL path
    submit-report.ts's notifyMlService() already calls
    (`${FASTAPI_ML_SERVICE_URL}/webhooks/monitoring-report`), so the
    frontend placeholder becomes real without also needing a frontend
    change. /api/v1/update-monitoring is kept as the Task 2-specified,
    more RESTful route name for direct/manual use (docs, curl, Postman)."""
    return await update_monitoring(payload, background_tasks, x_webhook_secret)


@app.get("/api/v1/live-score/{project_key}")
async def get_live_score(project_key: str):
    """Returns the most recently computed live score for a project, if any.
    Lets the frontend (or a manual check) confirm a background re-score
    actually completed, since the POST routes above return before scoring
    finishes."""
    import json

    if not LIVE_SCORES_PATH.exists():
        raise HTTPException(status_code=404, detail="No live scores recorded yet.")
    store = json.loads(LIVE_SCORES_PATH.read_text())
    if project_key not in store:
        raise HTTPException(status_code=404, detail=f"No live score recorded for {project_key}.")
    return store[project_key]


@app.get("/api/v1/latest-schedule")
async def get_latest_schedule():
    """Serves ml-service/optimization_engine.py's most recent PuLP solve
    output (artifacts/inspector_schedule.csv) as JSON, plus its summary
    stats (artifacts/inspector_schedule_summary.json), so the Next.js
    frontend's "Deploy latest schedule" action (actions/deploy-schedule.ts)
    can read it without assuming it's colocated on the same filesystem as
    this service -- the same reasoning /api/v1/model-metrics documents for
    reading training artifacts through an HTTP call rather than a direct
    file read from the frontend process.

    Read-only: this does NOT re-run optimization_engine.py. It serves
    whatever that script last wrote to disk."""
    import csv
    import json

    schedule_path = ARTIFACTS_DIR / "inspector_schedule.csv"
    if not schedule_path.exists():
        raise HTTPException(
            status_code=404,
            detail="No inspector schedule found yet -- run optimization_engine.py first.",
        )

    with open(schedule_path, newline="") as f:
        rows = list(csv.DictReader(f))

    summary_path = ARTIFACTS_DIR / "inspector_schedule_summary.json"
    summary = json.loads(summary_path.read_text()) if summary_path.exists() else None

    return {"rows": rows, "summary": summary}


@app.get("/api/v1/model-metrics")
async def get_model_metrics():
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
    import json

    def _read_json(filename: str) -> Optional[dict]:
        path = ARTIFACTS_DIR / filename
        if not path.exists():
            return None
        return json.loads(path.read_text())

    tree_models = _read_json("tree_models_metrics.json")
    lstm = _read_json("lstm_model_metrics.json")
    meta_learner = _read_json("meta_learner_metrics.json")

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
    }


@app.get("/health")
async def health():
    return {"status": "ok"}
