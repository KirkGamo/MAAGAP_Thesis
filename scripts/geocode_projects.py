"""
MAAGAP — Geocode `projects.location` into real coordinates (Phase 12.3)
================================================================================
Every map view in the Manager Portal (Risk Map, PPAs tab, Schedule tab) used
to place every project pin at its municipality's approximate town-center
coordinate (lib/municipality-coordinates.ts), nudged by a small deterministic
random offset (lib/pin-jitter.ts) purely so pins sharing a municipality
didn't stack on top of each other. That offset carries no relationship to
where a project actually is -- it was cosmetic scatter, not data, and the
municipality coordinates themselves are documented as "reasonable,
general-knowledge approximate coordinates, NOT surveyed centroids."

This script closes that gap using data that already exists: `projects.location`
is free-text (typically a barangay/address description) that has never been
geocoded. This script:

  1. Reads every project missing real coordinates (`latitude`/`longitude`
     IS NULL), or every project if `--force` is passed.
  2. Geocodes `"{location}, {municipality}, Iloilo, Philippines"` via the
     Nominatim (OpenStreetMap) geocoding API -- free, no API key required.
  3. Sanity-checks the result against a loose Iloilo Province bounding box.
     A result outside it almost always means Nominatim matched the wrong
     place (e.g. a same-named barangay in another province) -- those rows
     are left ungeocoded (logged, not silently written) rather than writing
     a confidently-wrong pin.
  4. Writes `latitude`/`longitude` back onto the matching `projects` row.

Once written, every map view already prefers these real coordinates over the
municipality-jitter approximation automatically -- see
frontend/src/lib/pin-jitter.ts's resolveProjectCoordinates(), which every map
component calls. No frontend change is needed after running this script;
pins for geocoded projects just become accurate the next time the page loads.

WHAT THIS SCRIPT DOES NOT DO
------------------------------
- It does not touch the municipality-jitter fallback logic itself -- that
  intentionally stays in place for any project that fails to geocode (a bad
  address, a demolished/informal location, network failure, etc.), so the
  map never has a project silently vanish just because geocoding didn't work
  for it.
- It does not retrain or touch anything in the ML pipeline -- `location` is
  read as-is from whatever seed_supabase.py already wrote.
- It is not a one-time-only script: re-running it only geocodes rows that
  are still missing coordinates (unless --force), so it's safe to schedule
  periodically as new projects get imported.

Nominatim usage policy
-----------------------
Nominatim's public instance requires a descriptive User-Agent identifying
the application and a contact means, and a maximum of 1 request/second --
both are respected here (see USER_AGENT and --sleep, default 1.1s). For a
province-wide one-time geocode of ~1,000 projects this takes roughly
15-20 minutes; that's expected, not a bug, and is why this script logs
progress per row rather than only a final summary.

Usage
-----
    pip install requests --break-system-packages   # if not already installed
    python scripts/geocode_projects.py [--dry-run] [--limit N] [--force] [--sleep 1.1]

Requires SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and
SUPABASE_SERVICE_ROLE_KEY in the environment -- same convention as
seed_supabase.py, including auto-loading frontend/.env.local if present.
Also requires add_projects_lat_lng.sql to have been run against the live
Supabase project first (adds the `latitude`/`longitude` columns this script
writes to) -- this script will fail loudly with Postgres's "column does not
exist" error if that migration hasn't been applied yet.
"""

from __future__ import annotations

import argparse
import logging
import os
import time
from pathlib import Path
from typing import Optional

import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("geocode_projects")

REPO_ROOT = Path(__file__).resolve().parent.parent
FRONTEND_ENV_LOCAL = REPO_ROOT / "frontend" / ".env.local"

NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
# Nominatim requires a descriptive User-Agent identifying the app + a contact
# method -- an unidentified/generic User-Agent gets silently rate-limited or
# blocked under their usage policy.
USER_AGENT = "MAAGAP-Thesis-Geocoder/1.0 (Iloilo PPDO project risk mapping; contact: kirkgamo@gmail.com)"

# Loose Iloilo Province bounding box (covers the mainland province, Guimaras
# strait area, and outlying northern islands like Concepcion's Sicogon) --
# generous on purpose. This is a sanity check to reject obviously-wrong
# geocodes (Nominatim matching a same-named barangay in a different
# province), not a precise boundary.
ILOILO_BOUNDS = {"lat_min": 10.2, "lat_max": 11.9, "lon_min": 121.7, "lon_max": 123.5}


def _load_frontend_env_local() -> None:
    """Same minimal KEY=VALUE parser as seed_supabase.py, reused so this
    script doesn't require credentials to be duplicated/re-exported."""
    if not FRONTEND_ENV_LOCAL.exists():
        return
    for line in FRONTEND_ENV_LOCAL.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key, value = key.strip(), value.strip().strip('"').strip("'")
        os.environ.setdefault(key, value)


def geocode_one(location: str, municipality: Optional[str]) -> Optional[tuple[float, float]]:
    """Looks up one address via Nominatim. Returns (lat, lng) if a result was
    found AND it falls inside ILOILO_BOUNDS, else None -- callers are
    responsible for logging *why* it came back None (no result vs.
    out-of-bounds vs. request error) so a Manager reviewing this script's
    output can tell those apart."""
    query_parts = [location.strip()]
    if municipality:
        query_parts.append(municipality.strip())
    query_parts.append("Iloilo")
    query_parts.append("Philippines")
    query = ", ".join(p for p in query_parts if p)

    resp = requests.get(
        NOMINATIM_URL,
        params={"q": query, "format": "jsonv2", "limit": 1},
        headers={"User-Agent": USER_AGENT},
        timeout=10,
    )
    resp.raise_for_status()
    results = resp.json()
    if not results:
        return None

    lat, lon = float(results[0]["lat"]), float(results[0]["lon"])
    if not (ILOILO_BOUNDS["lat_min"] <= lat <= ILOILO_BOUNDS["lat_max"]):
        return None
    if not (ILOILO_BOUNDS["lon_min"] <= lon <= ILOILO_BOUNDS["lon_max"]):
        return None
    return lat, lon


def update_with_retry(client, project_id: str, lat: float, lon: float, project_key: str) -> bool:
    """Writes one project's coordinates, retrying a few times with backoff
    before giving up. This script makes ~1,000 sequential HTTPS calls over
    15-20 minutes (one geocode + one Supabase write per project) -- long
    enough that a single transient network blip (a Wi-Fi hiccup, an ISP
    hiccup, Supabase/PostgREST closing an idle keep-alive connection) is
    expected, not exceptional. Without this, one reset partway through
    killed the entire run with an unhandled httpx.ReadError, discarding
    however much progress hadn't been written yet. Returns True on success,
    False if every attempt failed (logged, not raised, so the run
    continues with the next project instead of aborting)."""
    delays = [1, 3, 6]
    last_exc: Exception | None = None
    for attempt, delay in enumerate([0, *delays]):
        if delay:
            time.sleep(delay)
        try:
            client.table("projects").update({"latitude": lat, "longitude": lon}).eq(
                "id", project_id
            ).execute()
            return True
        except Exception as exc:  # noqa: BLE001 -- network/HTTP2 failures surface as
            # various httpx/httpcore exception types (ReadError, ConnectError,
            # RemoteProtocolError, ...); retrying broadly here is the point.
            last_exc = exc
            logger.warning(
                "[%s] Supabase write failed (attempt %d/%d): %s",
                project_key, attempt + 1, len(delays) + 1, exc,
            )
    logger.error("[%s] Giving up on this write after %d attempts: %s", project_key, len(delays) + 1, last_exc)
    return False


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--dry-run", action="store_true", help="Geocode and log results, but don't write to Supabase.")
    parser.add_argument("--limit", type=int, default=None, help="Only process the first N ungeocoded projects (for testing).")
    parser.add_argument("--force", action="store_true", help="Re-geocode every project, including ones that already have coordinates.")
    parser.add_argument("--sleep", type=float, default=1.1, help="Seconds to wait between geocoding requests (Nominatim's policy requires >= 1.0).")
    args = parser.parse_args()

    if args.sleep < 1.0:
        raise SystemExit("--sleep must be >= 1.0 -- Nominatim's usage policy caps requests at 1/second.")

    _load_frontend_env_local()
    url = os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    service_role_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not service_role_key:
        raise SystemExit(
            "Missing SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) / SUPABASE_SERVICE_ROLE_KEY. "
            "Set them in the environment, or make sure frontend/.env.local has them."
        )

    from supabase import create_client

    client = create_client(url, service_role_key)

    query = client.table("projects").select("id, project_key, location, municipality")
    if not args.force:
        query = query.is_("latitude", "null")
    if args.limit:
        query = query.limit(args.limit)

    projects = query.execute().data or []
    logger.info(
        "%d project(s) to geocode%s.",
        len(projects),
        " (--force: including already-geocoded ones)" if args.force else " (missing coordinates only)",
    )

    if not projects:
        logger.info("Nothing to do.")
        return

    geocoded = 0
    empty_location = 0
    no_usable_match = 0
    errors = 0
    write_errors = 0

    for i, project in enumerate(projects):
        location = project.get("location") or ""
        municipality = project.get("municipality")
        project_key = project.get("project_key", "?")

        if not location.strip():
            logger.warning("[%s] Skipping -- empty `location`.", project_key)
            empty_location += 1
            continue

        try:
            result = geocode_one(location, municipality)
        except requests.RequestException as exc:
            logger.error("[%s] Geocoding request failed: %s", project_key, exc)
            errors += 1
            time.sleep(args.sleep)
            continue

        if result is None:
            logger.info("[%s] No usable match for %r (municipality=%r).", project_key, location, municipality)
            no_usable_match += 1
            time.sleep(args.sleep)
            continue

        lat, lon = result
        logger.info("[%s] %r -> (%.5f, %.5f)", project_key, location, lat, lon)

        if not args.dry_run:
            if not update_with_retry(client, project["id"], lat, lon, project_key):
                write_errors += 1
                time.sleep(args.sleep)
                continue

        geocoded += 1
        # Respect Nominatim's rate limit between requests -- skip the sleep
        # after the very last row, purely so the script doesn't idle for no
        # reason at the end.
        if i < len(projects) - 1:
            time.sleep(args.sleep)

    logger.info(
        "Done. %d geocoded, %d with no usable match, %d empty `location`, %d geocoding request "
        "errors, %d Supabase write errors (out of %d total).",
        geocoded, no_usable_match, empty_location, errors, write_errors, len(projects),
    )
    if write_errors > 0:
        logger.info(
            "%d project(s) failed to write after retrying -- just re-run this script (with no "
            "flags) to pick up only the rows still missing coordinates.",
            write_errors,
        )
    if args.dry_run:
        logger.info("--dry-run: no rows were written to Supabase.")


if __name__ == "__main__":
    main()
