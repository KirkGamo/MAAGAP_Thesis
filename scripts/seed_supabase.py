"""
MAAGAP — Seed Supabase `projects` from ML pipeline outputs (Phase 9)
================================================================================
The Next.js dashboard reads exclusively from Supabase's `projects` table
(see frontend/src/app/manager/{page,backlog/page,map/page}.tsx) -- it has
no knowledge of data/ready/inference.csv or ml-service/artifacts/ at all.
Every prior phase built the ML pipeline and the frontend as two correct
but disconnected halves; this script is the one-time (or periodic) bridge
that actually populates the table the dashboard queries, using:

  1. data/ready/inference.csv -- the ongoing/unresolved project population
     (see feature_engineering.py's docstring: RedFlag is NaN exactly when
     there's no confirmed outcome yet, i.e. still in progress).
  2. ml-service/optimization_engine.py's score_ongoing_projects() -- reused
     as-is, not reimplemented, so this script can never silently drift from
     the scoring logic optimization_engine.py and the FastAPI feedback loop
     both already depend on. That function has a documented coverage
     caveat: only ongoing projects with BOTH a scoreable tabular row AND a
     matching LSTM event sequence get a full meta-learner score. Projects
     outside that overlap are still seeded (so the dashboard shows the full
     ongoing portfolio, not just the scored subset) but with risk_tier/
     risk_probability left NULL -- the frontend already renders this as
     "Unscored" (see badge.tsx / backlog/page.tsx), so this is a real,
     intentional distinction, not a bug to "fix" by guessing a score.

WHAT THIS SCRIPT DOES NOT DO
------------------------------
- It does not retrain anything or move projects between train/test/
  inference. It only reads already-computed outputs.
- It does not touch `inspector_schedules` or `monitoring_reports` --
  seeding the inspector deployment schedule from
  ml-service/artifacts/inspector_schedule.csv is a separate, not-yet-built
  step (the Manager Portal's Schedule page already documents this gap in
  actions/deploy-schedule.ts).
- It is not idempotent-by-accident: it upserts on `project_key` (the
  natural key both the ML pipeline and Supabase agree on), so re-running
  this script after a fresh pipeline run/retrain safely refreshes existing
  rows instead of duplicating them.

Usage
-----
    cd ml-service && python ../scripts/seed_supabase.py [--dry-run] [--limit N]

Requires SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and
SUPABASE_SERVICE_ROLE_KEY in the environment -- the service role key is
required (not the publishable/anon key) because this script must bypass
the `projects: managers full access` / `is_manager()` RLS policy (see
supabase/schema.sql) to write rows as a backend job with no signed-in
Supabase Auth user of its own. If frontend/.env.local exists, its values
are loaded automatically (no python-dotenv dependency needed for the tiny
KEY=VALUE parsing this requires).
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import re
import sys
from pathlib import Path
from typing import Optional

import numpy as np
import pandas as pd

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("seed_supabase")

REPO_ROOT = Path(__file__).resolve().parent.parent
ML_SERVICE_DIR = REPO_ROOT / "ml-service"
DATA_READY_DIR = REPO_ROOT / "data" / "ready"
FRONTEND_ENV_LOCAL = REPO_ROOT / "frontend" / ".env.local"

sys.path.insert(0, str(ML_SERVICE_DIR))

STATUS_TABLE = "projects"


def _load_frontend_env_local() -> None:
    """Minimal KEY=VALUE parser for frontend/.env.local, so this script can
    reuse the same Supabase credentials the Next.js app already has instead
    of requiring them to be duplicated/re-exported. Only sets a variable if
    it isn't already present in the environment (explicit env wins)."""
    if not FRONTEND_ENV_LOCAL.exists():
        return
    for line in FRONTEND_ENV_LOCAL.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key, value = key.strip(), value.strip().strip('"').strip("'")
        os.environ.setdefault(key, value)


def _clean_nan(value):
    """json/postgrest can't serialize numpy NaN/NaT -- normalize to None.

    `shap_top_features` (Phase 22) is a list of dicts, not a scalar --
    `pd.isna()` on a list/dict raises "the truth value of an array is
    ambiguous" rather than returning False, so those types must be
    short-circuited past the scalar NaN checks below instead of falling
    into them."""
    if value is None:
        return None
    if isinstance(value, (list, dict)):
        return value
    if isinstance(value, float) and np.isnan(value):
        return None
    if pd.isna(value):
        return None
    return value


def _safe_str(value, default: str) -> str:
    """`value or default` looks like the right fallback here, but it's
    wrong for pandas data: a missing cell comes through as `float('nan')`,
    and NaN is truthy in Python (`bool(float('nan'))` is True), so
    `nan or default` evaluates to `nan`, not `default` -- the fallback
    never fires and `.strip()` blows up downstream with exactly the
    AttributeError this caused. Check for NaN explicitly instead."""
    if value is None or (isinstance(value, float) and np.isnan(value)) or pd.isna(value):
        return default
    return str(value).strip()


def _to_iso_date(value) -> Optional[str]:
    ts = pd.to_datetime(value, errors="coerce")
    return None if pd.isna(ts) else ts.strftime("%Y-%m-%d")


# ---------------------------------------------------------------------------
# STATUS -> project_status enum mapping. Mirrors the substring-matching
# style already established in feature_engineering.py's
# COMPLETED_STATUS_SUBSTRINGS/ONGOING_STATUS_SUBSTRINGS (Phase 6/7), rather
# than inventing a new convention. Every row in inference.csv is, by
# construction, part of the ongoing/unresolved population (RedFlag is NaN
# here) -- so "on_going" is the correct default, and this only needs to
# special-case the two statuses that mean something more specific:
# genuinely not-yet-started work, and pre-implementation procurement.
# ---------------------------------------------------------------------------
BIDDING_SUBSTRINGS = ["bid", "procure", "philgeps", "canvass", "ntp", "notice to proceed"]
NOT_YET_IMPLEMENTED_SUBSTRINGS = ["not implement", "not yet implement", "not-implement", "unimplemented"]


def map_status(status_raw: str) -> str:
    if not isinstance(status_raw, str) or not status_raw.strip():
        return "on_going"
    s = status_raw.lower()
    if any(sub in s for sub in NOT_YET_IMPLEMENTED_SUBSTRINGS):
        return "not_yet_implemented"
    if any(sub in s for sub in BIDDING_SUBSTRINGS):
        return "for_bidding"
    return "on_going"


def resolve_project_type(row: pd.Series) -> str:
    """Reverses feature_engineering.py's one-hot project_type_* columns back
    into a single label, matching the projects.project_type CHECK constraint
    in supabase/schema.sql exactly."""
    if row.get("project_type_Infrastructure") == 1:
        return "Infrastructure"
    if row.get("project_type_Non-Infrastructure") == 1:
        return "Non-Infrastructure"
    return "Unclassified"


def unscale_amount(amount_scaled: float, scaler_params: dict) -> Optional[float]:
    """AMOUNT (Php) in inference.csv is min-max scaled to [0, 1] by
    feature_engineering.py's Step 11 (see data/ready/scaler_params.json) --
    scaling it back to PHP is required before showing it on the dashboard,
    or every project would display a value between 0 and 1."""
    if pd.isna(amount_scaled):
        return None
    params = scaler_params.get("AMOUNT (Php)")
    if params is None:
        return None
    return float(amount_scaled) * (params["max"] - params["min"]) + params["min"]


def build_project_rows(limit: Optional[int] = None) -> list[dict]:
    from optimization_engine import resolve_municipality, score_ongoing_projects  # noqa: E402

    inference_df = pd.read_csv(DATA_READY_DIR / "inference.csv", low_memory=False)
    if limit:
        inference_df = inference_df.head(limit)
    logger.info("Loaded %d ongoing/unresolved projects from inference.csv", len(inference_df))

    scaler_params = json.load(open(DATA_READY_DIR / "scaler_params.json"))

    try:
        scored = score_ongoing_projects()
        scored_lookup = scored.set_index("project_key")[
            ["risk_tier", "meta_prob", "shap_top_features"]
        ].to_dict("index")
    except Exception:
        logger.exception(
            "score_ongoing_projects() failed (likely missing ml-service/artifacts/*.joblib or "
            "*.keras -- have the Level 0/Level 1 models been trained yet?). Continuing with "
            "risk_tier/risk_probability left NULL for every project rather than aborting the seed."
        )
        scored_lookup = {}

    rows: list[dict] = []
    scored_count = 0
    unmapped_municipality_count = 0
    for _, row in inference_df.iterrows():
        project_key = row["project_key"]
        if not isinstance(project_key, str) or not project_key.strip():
            continue  # rows without a resolvable project_key can't be upserted on that key

        municipality = resolve_municipality(row.get("LOCATION"))
        if municipality == "Unmapped":
            unmapped_municipality_count += 1
            municipality = None

        score = scored_lookup.get(project_key)
        if score:
            scored_count += 1

        rows.append({
            "project_key": project_key,
            "name_of_project": _safe_str(row.get("NAME OF PROJECT"), "Untitled project")[:500],
            "location": _safe_str(row.get("LOCATION"), "Unknown")[:500],
            "municipality": municipality,
            "amount_php": unscale_amount(row.get("AMOUNT (Php)"), scaler_params),
            "status": map_status(row.get("STATUS")),
            "date_released": _to_iso_date(row.get("DATE RELEASED")),
            "date_of_completion": _to_iso_date(row.get("Date  of Completion")),
            "project_type": resolve_project_type(row),
            "risk_tier": score["risk_tier"] if score else None,
            "risk_probability": round(float(score["meta_prob"]), 4) if score else None,
            # Phase 22: top SHAP-contributing features (mean of Random
            # Forest's and XGBoost's probability-space contributions -- see
            # ml-service/inference/explain.py) for the "why this
            # classification?" panel on the project detail page. Left NULL
            # for the same unscored population risk_tier/risk_probability
            # already leave NULL (no LSTM sequence coverage, etc.).
            "shap_top_features": score.get("shap_top_features") if score else None,
        })

    logger.info(
        "Built %d project rows (%d scored by the meta-learner, %d unscored, %d with an "
        "unresolved municipality).",
        len(rows), scored_count, len(rows) - scored_count, unmapped_municipality_count,
    )
    return [{k: _clean_nan(v) for k, v in r.items()} for r in rows]


def push_to_supabase(rows: list[dict], batch_size: int = 500, dry_run: bool = False) -> None:
    if dry_run:
        logger.info("--dry-run: not writing to Supabase. Sample row:\n%s", json.dumps(rows[0], indent=2))
        return

    _load_frontend_env_local()
    url = os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    service_role_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not service_role_key:
        raise SystemExit(
            "Missing SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) / SUPABASE_SERVICE_ROLE_KEY. "
            "Set them in the environment, or make sure frontend/.env.local has them (this "
            "script auto-loads that file if present)."
        )

    from supabase import create_client

    client = create_client(url, service_role_key)

    for i in range(0, len(rows), batch_size):
        batch = rows[i : i + batch_size]
        result = client.table(STATUS_TABLE).upsert(batch, on_conflict="project_key").execute()
        logger.info(
            "Upserted batch %d-%d (%d rows). Supabase returned %d rows.",
            i, i + len(batch), len(batch), len(result.data or []),
        )

    logger.info("Done: %d project rows upserted into Supabase's `projects` table.", len(rows))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="Build rows and print a sample, but don't write to Supabase.")
    parser.add_argument("--limit", type=int, default=None, help="Only process the first N rows of inference.csv (for testing).")
    parser.add_argument("--batch-size", type=int, default=500, help="Rows per upsert call (default 500).")
    args = parser.parse_args()

    rows = build_project_rows(limit=args.limit)
    if not rows:
        logger.warning("No rows built -- nothing to seed.")
        return
    push_to_supabase(rows, batch_size=args.batch_size, dry_run=args.dry_run)


if __name__ == "__main__":
    main()
