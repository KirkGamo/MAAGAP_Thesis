"""
MAAGAP — Stored-versus-recomputed risk tier consistency check (Objective 3)
================================================================================
Reads every scored row in Supabase's `projects` table and asserts that the
stored `risk_tier` is exactly what `probability_to_risk_tier()` produces from
the stored `risk_probability`.

WHY THIS EXISTS
------------------------------------------------------------------------------
Objective 3 commits to "logic consistency testing". tests/test_risk_tiers.py
proves the mapping is correct and that all three consumers share one
definition; that is a statement about the code. This script is the
complementary statement about the *data*: it checks that what is actually
sitting in the production table agrees with that mapping.

Both halves are needed, because the two can diverge without any code being
wrong today — a row written by an older build, a partial reseed, or a manual
edit all produce a stored tier that no longer matches its own probability.
This is the same failure shape as the reporting-loop bug, where a field-
reported completion and its re-score disagreed and PostgREST returned no
error: nothing raises, the two halves of one record simply stop agreeing.

Exit codes
----------
    0   every scored row agrees (or the table holds no scored rows)
    1   at least one row disagrees, or a scored row carries an unusable
        probability (NaN / out of range)
    2   could not run — missing credentials or the supabase client

Usage
-----
    python scripts/check_tier_consistency.py
    python scripts/check_tier_consistency.py --limit-report 50
"""

from __future__ import annotations

import argparse
import logging
import math
import os
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "ml-service"))

from common.risk_tiers import probability_to_risk_tier  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("check_tier_consistency")

PAGE_SIZE = 1000


def _load_env() -> None:
    """Mirror the ml-service convention: credentials live in ml-service/.env."""
    env_path = REPO_ROOT / "ml-service" / ".env"
    if not env_path.exists():
        return
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip())


def _fetch_scored_rows(client) -> list[dict]:
    """Page through every row carrying a risk_probability."""
    rows: list[dict] = []
    start = 0
    while True:
        resp = (
            client.table("projects")
            .select("project_key,risk_tier,risk_probability")
            .not_.is_("risk_probability", "null")
            .range(start, start + PAGE_SIZE - 1)
            .execute()
        )
        batch = resp.data or []
        rows.extend(batch)
        if len(batch) < PAGE_SIZE:
            return rows
        start += PAGE_SIZE


def check(rows: list[dict], limit_report: int = 20) -> int:
    mismatches: list[tuple[str, float, str, str]] = []
    unusable: list[tuple[str, object]] = []

    for row in rows:
        key = row.get("project_key", "<no key>")
        prob = row.get("risk_probability")
        stored = row.get("risk_tier")
        try:
            expected = probability_to_risk_tier(prob)
        except (TypeError, ValueError):
            unusable.append((key, prob))
            continue
        if stored != expected:
            mismatches.append((key, float(prob), stored, expected))

    logger.info("Checked %d scored rows.", len(rows))

    if unusable:
        logger.error(
            "%d scored row(s) carry a probability that is not a usable "
            "probability (NaN / out of range). These would previously have been "
            "assigned a tier by fall-through:",
            len(unusable),
        )
        for key, prob in unusable[:limit_report]:
            logger.error("  %s -> risk_probability=%r", key, prob)

    if mismatches:
        logger.error(
            "%d row(s) disagree with the Chapter 3 tier boundaries:", len(mismatches)
        )
        for key, prob, stored, expected in mismatches[:limit_report]:
            logger.error(
                "  %s  p=%.4f  stored=%-8s  expected=%s", key, prob, stored, expected
            )
        if len(mismatches) > limit_report:
            logger.error("  ... and %d more", len(mismatches) - limit_report)

    if not mismatches and not unusable:
        if rows:
            logger.info(
                "PASS — every stored risk_tier matches the tier recomputed from "
                "its own risk_probability."
            )
        else:
            logger.warning(
                "No scored rows found. Nothing to check — this is not a pass."
            )
        return 0
    return 1


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--limit-report",
        type=int,
        default=20,
        help="How many offending rows to print in full (default: 20).",
    )
    args = parser.parse_args()

    _load_env()
    url = os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        logger.error(
            "Missing SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) / "
            "SUPABASE_SERVICE_ROLE_KEY. Put them in ml-service/.env or the "
            "environment."
        )
        return 2

    try:
        from supabase import create_client
    except ImportError:
        logger.error("supabase client not installed — pip install supabase")
        return 2

    client = create_client(url, key)
    return check(_fetch_scored_rows(client), limit_report=args.limit_report)


if __name__ == "__main__":
    raise SystemExit(main())
