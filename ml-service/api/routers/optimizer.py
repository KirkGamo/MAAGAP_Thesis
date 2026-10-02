"""
Optimizer run management.

POST starts a background solve; GET serves its progress. The run is
minutes-long, so the POST returns 202 immediately and the frontend polls.

Run state is a JSON file on disk and is NOT synchronised across workers -- with
more than one uvicorn worker the 409 concurrency guard can be raced. That is
tracked as R3 in the hardening plan; moving state into Supabase is the fix.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Header, HTTPException, Request

from api.deps import _check_rate_limit, _check_webhook_secret
from common.paths import OPTIMIZER_STATUS_PATH, SCHEDULE_CSV_PATH

logger = logging.getLogger("maagap.api.optimizer")

router = APIRouter()


# A "running" status older than this is treated as stale (service was
# killed mid-run and never wrote a terminal state) rather than blocking
# every future run behind a phantom.
OPTIMIZER_RUN_STALE_SECONDS = 30 * 60


def _read_optimizer_status() -> dict:

    if not OPTIMIZER_STATUS_PATH.exists():
        return {"state": "idle"}
    try:
        return json.loads(OPTIMIZER_STATUS_PATH.read_text())
    except (OSError, ValueError):
        return {"state": "idle"}


def _write_optimizer_status(state: str, started_at: str, error: Optional[str] = None) -> None:

    payload = {
        "state": state,
        "started_at": started_at,
        "finished_at": datetime.now(timezone.utc).isoformat() if state in ("done", "failed") else None,
        "error": error,
    }
    OPTIMIZER_STATUS_PATH.write_text(json.dumps(payload, indent=2))


def _run_optimizer_job(started_at: str) -> None:
    """Background job: full score + solve, exactly what running
    optimization_engine.py from the CLI does. Imported lazily so this
    module's startup stays light (optimization_engine pulls in the model
    stack, TensorFlow included, at scoring time)."""
    try:
        from optimization_engine import run as run_optimization

        run_optimization(str(SCHEDULE_CSV_PATH))
        _write_optimizer_status("done", started_at)
        logger.info("Optimizer run finished; schedule written to %s", SCHEDULE_CSV_PATH)
    except Exception as exc:
        logger.exception("Optimizer run failed")
        _write_optimizer_status("failed", started_at, error=str(exc))


@router.post("/api/v1/run-optimizer", status_code=202)
async def run_optimizer(
    background_tasks: BackgroundTasks,
    request: Request = None,  # noqa: B008 — FastAPI injects
    x_webhook_secret: Optional[str] = Header(None),
):
    """Starts a full optimizer run (risk scoring + PuLP solve) in the
    background. Secret-guarded like the monitoring webhook — this spends
    minutes of CPU, so it must not be open to anonymous callers."""
    _check_webhook_secret(x_webhook_secret)
    _check_rate_limit(request)

    status = _read_optimizer_status()
    if status.get("state") == "running":
        started = status.get("started_at")
        stale = True
        if started:
            try:
                started_dt = datetime.fromisoformat(started)
                stale = (
                    datetime.now(timezone.utc) - started_dt
                ).total_seconds() > OPTIMIZER_RUN_STALE_SECONDS
            except ValueError:
                pass
        if not stale:
            raise HTTPException(
                status_code=409,
                detail="An optimizer run is already in progress — wait for it to finish.",
            )
        logger.warning("Discarding stale 'running' optimizer status from %s", started)

    started_at = datetime.now(timezone.utc).isoformat()
    _write_optimizer_status("running", started_at)
    background_tasks.add_task(_run_optimizer_job, started_at)
    return {
        "accepted": True,
        "message": "Optimizer run started — poll /api/v1/optimizer-status for progress.",
    }


@router.get("/api/v1/optimizer-status")
async def get_optimizer_status(
    x_webhook_secret: Optional[str] = Header(None),
):
    """Read-only progress of the most recent optimizer run, plus when the
    schedule CSV on disk was last generated (by any run, background or
    CLI). Secret-guarded like every other route: S2 found that the
    read-only GETs leaked operational data, most seriously
    latest-schedule, which returns which inspector is at which project
    on which day."""
    _check_webhook_secret(x_webhook_secret)
    status = _read_optimizer_status()
    generated_at = None
    if SCHEDULE_CSV_PATH.exists():
        generated_at = datetime.fromtimestamp(
            SCHEDULE_CSV_PATH.stat().st_mtime, tz=timezone.utc
        ).isoformat()
    return {**status, "schedule_generated_at": generated_at}


