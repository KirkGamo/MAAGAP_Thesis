"""
MAAGAP — where the service reads models and where it writes results
================================================================================
Separates the two, because they have opposite deployment requirements and were
previously the same directory.

WHY THIS EXISTS
------------------------------------------------------------------------------
Everything the service loads (models, prepared data) and everything it produces
(the schedule, its summary, live scores, optimizer run status) lived together in
`ml-service/artifacts/`. Locally that is convenient and harmless. Deployed it is
a contradiction:

  - the models are IMMUTABLE and baked into the image, so they must come from
    the image on every start, and
  - the results are MUTABLE and worth keeping across restarts, so they must
    come from a volume.

You cannot satisfy both with one directory. Mounting a volume over artifacts/ to
persist the results makes Docker populate the empty volume from the image once
and then never refresh it, so the volume shadows the models permanently: rebuild
with a retrained model and the container keeps scoring with the OLD weights
while reporting the new image's version. That is the same silent-substitution
failure as the fabricated LSTM input, and it would be invisible from the
outside.

So the writable set moves to its own directory, pointed at by
ML_SERVICE_OUTPUT_DIR, and the volume goes there instead. artifacts/ stays
exactly as the image built it.

DEFAULT IS UNCHANGED BEHAVIOUR. With ML_SERVICE_OUTPUT_DIR unset, OUTPUT_DIR is
artifacts/ — identical to how this has always worked, so local development, the
pipeline scripts and the test suite are unaffected. Only a deployment that sets
the variable gets the split.

WHAT PERSISTENCE BUYS, concretely: a solve takes minutes of CBC time, and
inspector_schedule.csv is how GET /api/v1/latest-schedule answers. Without a
volume, a container restart between solving and deploying a schedule throws the
solve away and it has to be re-run.
"""

from __future__ import annotations

import logging
import os
from pathlib import Path

logger = logging.getLogger("maagap.paths")

ML_SERVICE_DIR = Path(__file__).resolve().parent.parent
REPO_ROOT = ML_SERVICE_DIR.parent

# -- read-only inputs, baked into the image ---------------------------------
ARTIFACTS_DIR = ML_SERVICE_DIR / "artifacts"
DATA_READY_DIR = REPO_ROOT / "data" / "ready"


def _resolve_output_dir() -> Path:
    """OUTPUT_DIR from the environment, defaulting to artifacts/.

    Created if absent: a volume is mounted empty, and failing at startup
    because a directory the service owns does not exist yet would be a pointless
    deployment step to remember.
    """
    raw = (os.environ.get("ML_SERVICE_OUTPUT_DIR") or "").strip()
    if not raw:
        return ARTIFACTS_DIR

    path = Path(raw).expanduser()
    try:
        path.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        raise RuntimeError(
            f"ML_SERVICE_OUTPUT_DIR is set to {raw!r} but that directory could not "
            f"be created: {exc}. This is where the optimizer's schedule, its "
            "summary, live scores and run status are written; the service cannot "
            "work without somewhere to put them."
        ) from None

    logger.info("Writing results to %s (ML_SERVICE_OUTPUT_DIR)", path)
    return path


# -- writable outputs -------------------------------------------------------
OUTPUT_DIR = _resolve_output_dir()

#: The optimizer's schedule. `optimization_engine.py` derives the summary from
#: this path (`<stem>_summary.json`), so the summary follows it automatically.
SCHEDULE_CSV_PATH = OUTPUT_DIR / "inspector_schedule.csv"
SCHEDULE_SUMMARY_PATH = OUTPUT_DIR / "inspector_schedule_summary.json"

#: Which optimizer run is in flight. Still a single unlocked file, so the 409
#: concurrency guard that reads it holds only within one process -- which is why
#: the image pins one uvicorn worker (R3). Moving this into Supabase is what
#: would allow more.
OPTIMIZER_STATUS_PATH = OUTPUT_DIR / "optimizer_run_status.json"

#: Live re-score results. A local cache, not the source of truth: the
#: authoritative risk tier is the Supabase column the re-score patches.
LIVE_SCORES_PATH = OUTPUT_DIR / "live_scores.json"


def output_dir_is_separate() -> bool:
    """True when results are written somewhere other than artifacts/, i.e. the
    deployed configuration."""
    return OUTPUT_DIR.resolve() != ARTIFACTS_DIR.resolve()
