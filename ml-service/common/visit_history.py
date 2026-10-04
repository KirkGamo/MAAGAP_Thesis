"""
MAAGAP — recent-visit history, for the scheduler's revisit cooldown (R1)
================================================================================
Answers one question: which projects have been visited recently enough that
scheduling them again this week would be wasteful?

WHY THIS EXISTS
------------------------------------------------------------------------------
`select_priority_projects()` consulted no record of prior visits at all. Its
only exclusions were completed/refunded status and an unmappable cluster. That
makes the weekly schedule a pure function of the current risk scores, with two
consequences observed on the deployed system:

  - The solve returns the SAME projects every week. Nothing in its inputs
    changes between runs, so nothing in its output does either.
  - High-tier projects are never scheduled. The live population held 79
    Critical against a weekly capacity of 60, and Critical outweighs High 2.5
    to 1.0, so capacity was exhausted on Critical before any High project was
    considered. All 60 scheduled visits were Critical.

A revisit cooldown breaks both. Once a project has been visited it leaves the
candidate pool for a period, which lets the next tier down become reachable and
makes successive schedules differ.

WHAT COUNTS AS A VISIT, AND WHAT DELIBERATELY DOES NOT
------------------------------------------------------------------------------
A visit is a row in `monitoring_reports` -- an inspector went to the site and
filed a report. That is an observation, and observations are what should start
a cooldown.

An assignment in `inspector_schedules` is NOT a visit and does not start one.
A project that was scheduled last week but never actually visited still needs
visiting, and excluding it would quietly drop outstanding work: the schedule
would stop recommending it while nothing had been learned about it. Keeping
assignment and observation distinct is the whole reason `monitoring_reports`
exists separately from `inspector_schedules`.

DEGRADING WITHOUT LYING
------------------------------------------------------------------------------
The optimizer is designed to run without Supabase -- it scores from
data/ready/inference.csv on disk. So an unreachable database must not stop a
solve. But "no cooldown applied" is exactly the permissive default that this
codebase has been bitten by before (an unset secret meaning authentication off,
an absent LSTM sequence meaning fabricate one). So the fallback here is loud and
recorded: a warning naming the reason, and `applied: False` carried into the run
summary, so a schedule produced without a cooldown can never be mistaken for one
produced with it.
"""

from __future__ import annotations

import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Optional

from common.settings import load_env_file

logger = logging.getLogger("maagap.visit_history")

#: Minimum days between site visits to the same project. A policy parameter,
#: not a modelling one -- PPDO owns the real number. Four weeks is the working
#: default: short enough that a Critical project is revisited within a month,
#: long enough that one week's schedule differs from the next.
DEFAULT_COOLDOWN_DAYS = 28


def cooldown_days() -> int:
    """The configured cooldown, from ML_SERVICE_REVISIT_COOLDOWN_DAYS.

    0 disables the cooldown, which is a legitimate choice (and the behaviour of
    every run before this existed) but is reported as such rather than being
    indistinguishable from a database that could not be reached.
    """
    raw = (os.environ.get("ML_SERVICE_REVISIT_COOLDOWN_DAYS") or "").strip()
    if not raw:
        return DEFAULT_COOLDOWN_DAYS
    try:
        value = int(raw)
    except ValueError:
        logger.warning(
            "ML_SERVICE_REVISIT_COOLDOWN_DAYS=%r is not a whole number — using the "
            "default of %d days.", raw, DEFAULT_COOLDOWN_DAYS,
        )
        return DEFAULT_COOLDOWN_DAYS
    if value < 0:
        logger.warning(
            "ML_SERVICE_REVISIT_COOLDOWN_DAYS=%d is negative — using the default of "
            "%d days.", value, DEFAULT_COOLDOWN_DAYS,
        )
        return DEFAULT_COOLDOWN_DAYS
    return value


def recently_visited_keys(
    days: Optional[int] = None,
    *,
    now: Optional[datetime] = None,
) -> tuple[set[str], dict]:
    """Project keys visited within the cooldown window.

    Returns `(keys, provenance)`. `provenance` is meant to be written into the
    run summary verbatim, so a schedule records whether a cooldown was applied,
    for how long, and on how many projects.

    `now` is injectable so the behaviour can be tested against a fixed clock
    rather than whatever today happens to be.
    """
    window = cooldown_days() if days is None else days
    provenance: dict = {
        "cooldown_days": window,
        "applied": False,
        "excluded_projects": 0,
        "source": "monitoring_reports.visited_at",
        "reason": None,
    }

    if window == 0:
        provenance["reason"] = (
            "cooldown disabled (ML_SERVICE_REVISIT_COOLDOWN_DAYS=0); every project "
            "is eligible every week, so successive schedules may be identical"
        )
        logger.warning("Revisit cooldown is DISABLED — %s.", provenance["reason"])
        return set(), provenance

    # Load ml-service/.env if the caller has not already. main.py does this via
    # get_settings() before any request runs, but optimization_engine.py is also
    # a documented CLI workflow (HANDOFF.md section 4) and has no such step --
    # so without this, a CLI solve silently found no credentials and built every
    # schedule without a cooldown. The loader never overwrites a variable that
    # is already set, so an explicit export or a container's environment still
    # wins.
    load_env_file()

    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not (url and key):
        provenance["reason"] = (
            "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set, so visit history "
            "could not be read; the schedule was built WITHOUT a revisit cooldown"
        )
        logger.warning(
            "No Supabase credentials — %s. Recently-visited projects will be "
            "scheduled again.", provenance["reason"],
        )
        return set(), provenance

    cutoff = (now or datetime.now(timezone.utc)) - timedelta(days=window)

    try:
        from supabase import create_client

        client = create_client(url, key)
        # projects(project_key) follows the monitoring_reports.project_id FK;
        # the optimizer keys everything on project_key, the UUID never reaches it.
        rows = (
            client.table("monitoring_reports")
            .select("visited_at, projects(project_key)")
            .gte("visited_at", cutoff.isoformat())
            .execute()
            .data
        )
    except Exception as exc:  # noqa: BLE001 — a solve must not die on a read
        provenance["reason"] = f"visit history could not be read ({type(exc).__name__}: {exc})"
        logger.exception(
            "Could not read visit history — the schedule will be built WITHOUT a "
            "revisit cooldown, so it may repeat last week's projects."
        )
        return set(), provenance

    keys = {
        row["projects"]["project_key"]
        for row in rows
        if row.get("projects") and row["projects"].get("project_key")
    }

    provenance["applied"] = True
    provenance["excluded_projects"] = len(keys)
    provenance["cutoff"] = cutoff.isoformat()

    logger.info(
        "Revisit cooldown: %d project(s) visited since %s are excluded from this "
        "week's candidate pool (%d-day window).",
        len(keys), cutoff.date(), window,
    )
    return keys, provenance
