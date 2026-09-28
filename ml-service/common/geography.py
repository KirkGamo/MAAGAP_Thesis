"""
MAAGAP — Real geography for Iloilo (barangay points, centroids, distances)
================================================================================
Turns PPDO's LMB barangay point layer into the municipality centroids and
great-circle distances the optimizer needs, replacing the flat per-cluster
travel charge with one that prices actual travel.

WHY THIS EXISTS
------------------------------------------------------------------------------
`optimization_engine.py` has documented its own geographic model as provisional
since it was written:

    "The 'neighboring municipality' grouping used for the travel-friction
     constraint (MUNICIPALITY_CLUSTERS below) is built from Iloilo province's
     commonly recognized sub-regional geography ... It is NOT sourced from an
     authoritative PSGC/GIS boundary-adjacency dataset or a real road-network
     distance matrix ... and should be replaced with verified centroid-distance
     or shared-boundary adjacency data before this schedule is used
     operationally."

PPDO's 2026-09 GIS export supplies that data. This module is the replacement
for the *distance* half of that request. It does NOT re-draw the clusters
themselves -- see the note below.

WHAT THIS DELIBERATELY DOES NOT DO
------------------------------------------------------------------------------
It does not change cluster membership or cluster names. Those names are
load-bearing well beyond the solver: they are stored on `inspector_schedules`
rows in Supabase, rendered across the Schedule workspace, the routing map, the
agenda pane and the inspector's own view, and carried through the deploy action.
Re-drawing them geographically is a defensible follow-up, but it is a migration,
not a calculation, and bundling it into a costing change would make both
impossible to evaluate separately.

What changes here is what a cluster COSTS, not which municipalities are in it.

PRECISION CAVEAT
------------------------------------------------------------------------------
The underlying points are barangay locations, not project sites, and distances
are great-circle rather than road-network. A project is placed at its
municipality's centroid, which is the average of that municipality's barangay
points. Report figures derived from this as centroid-level approximations. It is
a substantial improvement on a five-bucket hand-drawn grouping; it is not a
routing engine.

Iloilo City has no points in the layer, and that is correct rather than missing:
it is a highly urbanized city administratively outside the Provincial Planning
and Development Office's remit. Callers get None for it and must handle that.
"""

from __future__ import annotations

import logging
import math
from functools import lru_cache
from pathlib import Path
from typing import Optional

import pandas as pd

logger = logging.getLogger("maagap.geography")

REFERENCE_PATH = (
    Path(__file__).resolve().parent.parent
    / "data_pipeline" / "reference" / "lmb_barangay_points_iloilo.csv"
)

EARTH_RADIUS_KM = 6371.0088

# ---------------------------------------------------------------------------
# PPDO deployment base. Inspectors depart from and return to the Provincial
# Capitol in Iloilo City, so distance-from-base is what a mobilization actually
# costs.
#
# *** APPROXIMATE COORDINATE — CONFIRM WITH PPDO. *** This is the Iloilo
# Provincial Capitol's published location, not a surveyed point supplied by the
# office, and it is not in the LMB layer (which covers the province, not the
# city). Treat it exactly as VISIT_COST_PHP and MUNICIPALITY_CLUSTERS are
# treated: a clearly-flagged placeholder a domain expert should replace.
# ---------------------------------------------------------------------------
PPDO_BASE_LAT = 10.6969
PPDO_BASE_LON = 122.5644

# Vehicle running cost per kilometre. Also a placeholder pending PPDO's own
# travel schedule; see optimization_engine's cost constants.
TRAVEL_COST_PHP_PER_KM = 15.0


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance in kilometres."""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlam / 2) ** 2
    return 2 * EARTH_RADIUS_KM * math.asin(math.sqrt(a))


@lru_cache(maxsize=1)
def load_barangay_points() -> Optional[pd.DataFrame]:
    """The committed LMB reference, or None when it has not been built yet.

    Returning None rather than raising is deliberate: every consumer here is
    expected to fall back to the pre-geography behaviour, so a fresh checkout
    that has not run scripts/build_barangay_points_reference.py still solves.
    """
    if not REFERENCE_PATH.exists():
        logger.warning(
            "Barangay point reference not found at %s — geography-aware costing is "
            "disabled and flat costs will be used. Run "
            "scripts/build_barangay_points_reference.py to enable it.",
            REFERENCE_PATH,
        )
        return None
    return pd.read_csv(REFERENCE_PATH)


@lru_cache(maxsize=1)
def municipality_centroids() -> dict[str, tuple[float, float]]:
    """{municipality_canonical: (lat, lon)}, averaged over its barangay points."""
    pts = load_barangay_points()
    if pts is None or pts.empty:
        return {}
    grouped = pts.groupby("municipality_canonical")[["lat", "lon"]].mean()
    return {str(k): (float(v["lat"]), float(v["lon"])) for k, v in grouped.iterrows()}


def municipality_centroid(municipality: str) -> Optional[tuple[float, float]]:
    return municipality_centroids().get(municipality)


def cluster_centroid(
    municipalities: list[str],
) -> Optional[tuple[float, float]]:
    """Centroid of the municipalities that resolve to coordinates. Returns None
    when none of them do, so the caller can fall back rather than average an
    empty set into a NaN that would poison the objective."""
    known = [municipality_centroid(m) for m in municipalities]
    known = [c for c in known if c is not None]
    if not known:
        return None
    return (
        sum(c[0] for c in known) / len(known),
        sum(c[1] for c in known) / len(known),
    )


def distance_from_base_km(lat: float, lon: float) -> float:
    return haversine_km(PPDO_BASE_LAT, PPDO_BASE_LON, lat, lon)


def cluster_mobilization_costs(
    cluster_members: dict[str, list[str]],
    cost_per_km: float = TRAVEL_COST_PHP_PER_KM,
    flat_fallback_php: float = 1200.0,
) -> dict[str, float]:
    """
    Round-trip travel cost of working each cluster once in a week:

        cost(c) = cost_per_km * 2 * distance(base, centroid(c))

    Clusters whose municipalities carry no coordinates keep the flat fallback,
    with the substitution logged — silently pricing an unlocatable cluster at
    zero would make it look free and attract every visit.
    """
    costs: dict[str, float] = {}
    unresolved: list[str] = []
    for cluster, members in cluster_members.items():
        centroid = cluster_centroid(members)
        if centroid is None:
            costs[cluster] = flat_fallback_php
            unresolved.append(cluster)
            continue
        costs[cluster] = round(cost_per_km * 2 * distance_from_base_km(*centroid), 2)
    if unresolved:
        logger.warning(
            "%d cluster(s) had no locatable municipality and kept the flat PHP %.0f "
            "mobilization cost: %s",
            len(unresolved), flat_fallback_php, unresolved,
        )
    return costs


def municipality_distance_matrix() -> dict[tuple[str, str], float]:
    """Pairwise great-circle distances between municipality centroids."""
    cents = municipality_centroids()
    names = sorted(cents)
    out: dict[tuple[str, str], float] = {}
    for i, a in enumerate(names):
        for b in names[i:]:
            d = haversine_km(*cents[a], *cents[b])
            out[(a, b)] = out[(b, a)] = round(d, 3)
    return out
