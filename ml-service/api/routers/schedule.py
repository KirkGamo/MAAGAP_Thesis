"""
Deployment schedule reads.

Serves optimization_engine.py's most recent PuLP solve output so the frontend's
"Deploy latest schedule" action has something to deploy.
"""

from __future__ import annotations

import csv
import json
import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Header, HTTPException

from api.deps import _check_webhook_secret
from common.paths import SCHEDULE_CSV_PATH, SCHEDULE_SUMMARY_PATH

logger = logging.getLogger("maagap.api.schedule")

router = APIRouter()

@router.get("/api/v1/latest-schedule")
async def get_latest_schedule(
    x_webhook_secret: Optional[str] = Header(None),
):
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
    _check_webhook_secret(x_webhook_secret)

    schedule_path = SCHEDULE_CSV_PATH
    if not schedule_path.exists():
        raise HTTPException(
            status_code=404,
            detail="No inspector schedule found yet -- run optimization_engine.py first.",
        )

    with open(schedule_path, newline="") as f:
        rows = list(csv.DictReader(f))

    summary_path = SCHEDULE_SUMMARY_PATH
    summary = json.loads(summary_path.read_text()) if summary_path.exists() else None

    generated_at = datetime.fromtimestamp(
        schedule_path.stat().st_mtime, tz=timezone.utc
    ).isoformat()

    return {"rows": rows, "summary": summary, "generated_at": generated_at}


