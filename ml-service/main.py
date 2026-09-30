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
                                 project's `risk_tier`/`risk_probability`/
                                 `shap_top_features` columns in Supabase so
                                 the Next.js frontend reflects it
                                 immediately. If unset, the
                                 refreshed score still persists locally to
                                 artifacts/live_scores.json and is available
                                 via GET /api/v1/live-score/{project_key} —
                                 Supabase is a nice-to-have here, not a hard
                                 dependency (see live_scoring.py's
                                 `_persist_live_score` docstring).
"""

import logging
import os
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("maagap.main")

# ---------------------------------------------------------------------------
# B2: one validated settings object, built and checked once at import. The
# rules it enforces -- most importantly that an absent webhook secret is a
# refusal to start rather than authentication silently off -- live in
# common/settings.py so they are stated once instead of re-checked at each use
# site.
# ---------------------------------------------------------------------------
try:
    from common.settings import get_settings
except ImportError:  # imported from inside ml-service/ without the package root
    import sys as _sys

    _sys.path.insert(0, str(Path(__file__).resolve().parent))
    from common.settings import get_settings

settings = get_settings()
settings.log_startup_summary()

app = FastAPI(
    title="MAAGAP ML Service",
    description=(
        "Predictive risk assessment + resource allocation microservice for "
        "PPDO Iloilo Province project management (MAAGAP thesis system)."
    ),
    version="0.9.0",
)

# ---------------------------------------------------------------------------
# S5: CORS is declared, not left to chance. Empty by default and usually
# correct -- the Next.js frontend calls this service from the SERVER side,
# where CORS does not apply. An entry is only needed for genuine
# browser-to-service calls, which currently do not exist. Declaring it empty
# means the first deploy-day CORS error is fixed by adding an origin rather
# than by reaching for allow_origins=["*"] on a service holding project risk
# data and inspector schedules.
# ---------------------------------------------------------------------------
ALLOWED_ORIGINS = settings.allowed_origins

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["X-Webhook-Secret", "Content-Type"],
)

# ---------------------------------------------------------------------------
# B1: routes live in api/routers/, one module per concern. main.py builds the
# app, declares middleware, and mounts them -- nothing else. Previously this
# file was 735 lines holding eight endpoints, their Pydantic models,
# background-task orchestration, status-file I/O and metric assembly, so every
# new endpoint enlarged the blast radius of a merge.
# ---------------------------------------------------------------------------
from api.routers import metrics, monitoring, optimizer, schedule  # noqa: E402

app.include_router(monitoring.router)
app.include_router(schedule.router)
app.include_router(optimizer.router)
app.include_router(metrics.router)

# ---------------------------------------------------------------------------
# Backwards-compatible re-exports.
#
# tests/ and any operator script reference these on `main`. They are aliases
# for the real definitions, which now live in api/deps.py and the routers --
# kept so this refactor moves code without breaking callers.
# ---------------------------------------------------------------------------
from api.deps import (  # noqa: E402,F401
    ALLOW_UNAUTHENTICATED,
    RATE_LIMIT_MAX_REQUESTS,
    RATE_LIMIT_WINDOW_SECONDS,
    WEBHOOK_SECRET,
    _check_rate_limit,
    _check_webhook_secret,
)
from api.routers.monitoring import (  # noqa: E402,F401
    UpdateMonitoringPayload,
    UpdateMonitoringResponse,
)


@app.get("/health")
async def health():
    return {"status": "ok"}
