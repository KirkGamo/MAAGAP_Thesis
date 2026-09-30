"""
Monitoring ingestion and live scoring.

Owns the inspector submission path -- the webhook, its payload model, the
background re-score, and the Supabase write-back -- plus the live-score lookup
the frontend polls to confirm a re-score landed.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Header, HTTPException, Request
from pydantic import BaseModel, Field

from api.deps import _check_rate_limit, _check_webhook_secret, settings
from inference.live_scoring import ARTIFACTS_DIR, LIVE_SCORES_PATH, score_project

logger = logging.getLogger("maagap.api.monitoring")

router = APIRouter()

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
    report_id: Optional[str] = Field(
        None,
        description=(
            "The monitoring_reports row this observation came from, when the caller has one. "
            "Used only to write the re-score outcome back to that row's rescore_state "
            "(see supabase/add_monitoring_reports_rescore_state.sql), so a dropped or failed "
            "re-score is visible in the Manager Portal and retryable, instead of vanishing the "
            "way this fire-and-forget webhook previously allowed. Not a model input."
        ),
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


def _mark_rescore_state(
    report_id: Optional[str], state: str, error: Optional[str] = None
) -> None:
    """Records how a re-score ended on the monitoring report that triggered
    it. Best-effort and never raises: this is observability for a webhook
    that is itself fire-and-forget, so failing to write the state must not
    turn into a second silent failure on top of the first.

    No-ops when the caller sent no report_id (e.g. a manual curl, or a
    frontend running against a database where
    add_monitoring_reports_rescore_state.sql hasn't been applied yet)."""
    if not report_id:
        return

    url = settings.supabase_url
    service_role_key = settings.supabase_service_role_key
    if not (url and service_role_key):
        # Logged, never silent: without this line a report sits at
        # 'pending' forever in the Manager Portal with a Retry button that
        # cannot possibly resolve it, and the cause is invisible.
        logger.warning(
            "Re-score for report %s finished as %r but SUPABASE_URL/"
            "SUPABASE_SERVICE_ROLE_KEY are not set, so the outcome cannot be written back. "
            "The report will stay 'Awaiting re-score' in the Manager Portal.",
            report_id, state,
        )
        return

    try:
        from supabase import create_client

        client = create_client(url, service_role_key)
        client.table("monitoring_reports").update(
            {
                "rescore_state": state,
                "rescored_at": datetime.now(timezone.utc).isoformat(),
                "rescore_error": error,
            }
        ).eq("id", report_id).execute()
        logger.info("Marked report %s rescore_state=%s.", report_id, state)
    except Exception:
        logger.exception("Could not record rescore_state for report %s (non-fatal).", report_id)


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
        _mark_rescore_state(payload.report_id, "failed", f"Pipeline artifacts missing: {exc}")
        return
    except Exception as exc:
        logger.exception("Unhandled error re-scoring project %s", payload.project_key)
        _mark_rescore_state(payload.report_id, "failed", str(exc))
        return

    if not result.found:
        # Not an error: the project has no trained representation to
        # re-score (see live_scoring.score_project's `found` flag), so
        # retrying would do exactly the same nothing.
        logger.warning("Re-score skipped for %s: %s", payload.project_key, result.message)
        _mark_rescore_state(payload.report_id, "skipped", result.message)
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

    _maybe_patch_supabase(
        payload.project_key, result.risk_tier, result.meta_prob, result.shap_top_features
    )
    _mark_rescore_state(payload.report_id, "done")


def _maybe_patch_supabase(
    project_key: str,
    risk_tier: Optional[str],
    risk_probability: Optional[float],
    shap_top_features: Optional[list] = None,
) -> None:
    """Best-effort push of the refreshed score back into Supabase's
    `projects` table, so the Manager Portal's backlog/map views reflect it
    without waiting on a full pipeline re-run. No-ops with a log line if
    Supabase service-role credentials aren't configured — this mirrors the
    honest-placeholder pattern used elsewhere in this project (see
    submit-report.ts's docstring), except here the code path itself is
    real; only its credentials are optional."""
    url = settings.supabase_url
    service_role_key = settings.supabase_service_role_key
    if not (url and service_role_key):
        logger.info(
            "SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY not configured — refreshed score for %s "
            "persisted locally only (see %s). Set both env vars to also push it live.",
            project_key, LIVE_SCORES_PATH,
        )
        return

    try:
        from supabase import create_client

        update_payload = {"risk_tier": risk_tier, "risk_probability": risk_probability}
        if shap_top_features is not None:
            update_payload["shap_top_features"] = shap_top_features

        client = create_client(url, service_role_key)
        client.table("projects").update(update_payload).eq("project_key", project_key).execute()
        logger.info("Patched Supabase projects row for %s.", project_key)
    except Exception:
        logger.exception("Best-effort Supabase patch failed for %s (non-fatal).", project_key)


@router.post("/api/v1/update-monitoring", response_model=UpdateMonitoringResponse, status_code=202)
async def update_monitoring(
    payload: UpdateMonitoringPayload,
    background_tasks: BackgroundTasks,
    request: Request = None,  # noqa: B008 — FastAPI injects
    x_webhook_secret: Optional[str] = Header(None),
):
    """Accepts an inspector's field-monitoring observation and queues a
    background re-score. Returns 202 immediately — the caller (the
    Next.js Server Action) must not block on model inference."""
    _check_webhook_secret(x_webhook_secret)
    _check_rate_limit(request)
    background_tasks.add_task(_run_rescore, payload)
    return UpdateMonitoringResponse(
        accepted=True, project_key=payload.project_key,
        message="Update accepted; re-scoring in background.",
    )


@router.post("/webhooks/monitoring-report", response_model=UpdateMonitoringResponse, status_code=202)
async def monitoring_report_webhook(
    payload: UpdateMonitoringPayload,
    background_tasks: BackgroundTasks,
    request: Request = None,  # noqa: B008 — FastAPI injects
    x_webhook_secret: Optional[str] = Header(None),
):
    """Alias of /api/v1/update-monitoring under the URL path
    submit-report.ts's notifyMlService() already calls
    (`${FASTAPI_ML_SERVICE_URL}/webhooks/monitoring-report`), so the
    frontend placeholder becomes real without also needing a frontend
    change. /api/v1/update-monitoring is kept as the Task 2-specified,
    more RESTful route name for direct/manual use (docs, curl, Postman)."""
    # Keyword arguments, not positional. update_monitoring() grew a `request`
    # parameter for rate limiting, and a positional call silently bound the
    # secret to it -- leaving x_webhook_secret at its Header(None) sentinel and
    # sending a FieldInfo object into hmac.compare_digest(). Delegating by
    # keyword makes this call immune to further signature growth.
    return await update_monitoring(
        payload,
        background_tasks,
        request=request,
        x_webhook_secret=x_webhook_secret,
    )


@router.get("/api/v1/live-score/{project_key}")
async def get_live_score(
    project_key: str,
    x_webhook_secret: Optional[str] = Header(None),
):
    """Returns the most recently computed live score for a project, if any.
    Lets the frontend (or a manual check) confirm a background re-score
    actually completed, since the POST routes above return before scoring
    finishes."""
    _check_webhook_secret(x_webhook_secret)
    import json

    if not LIVE_SCORES_PATH.exists():
        raise HTTPException(status_code=404, detail="No live scores recorded yet.")
    store = json.loads(LIVE_SCORES_PATH.read_text())
    if project_key not in store:
        raise HTTPException(status_code=404, detail=f"No live score recorded for {project_key}.")
    return store[project_key]


