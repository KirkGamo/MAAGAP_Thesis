"""
Tests for ml-service/common/geography.py and the LMB barangay point reference
(D18): real coordinates replacing the flat per-cluster travel charge.

The most valuable assertion here is the coordinate-orientation one. A swapped
latitude and longitude produces numbers that are the right shape, in the right
units, and completely wrong -- Iloilo's 10.7 N / 122.5 E becomes a point in
Somalia -- and nothing downstream would raise. Every distance, cost and map
marker would simply be silently incorrect. The source columns are named
POINT_X / POINT_Y rather than lon / lat, so the opportunity to swap them is real.
"""

from __future__ import annotations

import math

import pytest

from common.geography import (
    PPDO_BASE_LAT,
    PPDO_BASE_LON,
    cluster_centroid,
    cluster_mobilization_costs,
    distance_from_base_km,
    haversine_km,
    load_barangay_points,
    municipality_centroid,
    municipality_centroids,
)

# Iloilo province envelope. Deliberately tight enough that a lat/lon swap fails.
LON_RANGE = (121.5, 123.8)
LAT_RANGE = (10.0, 12.0)


# ---------------------------------------------------------------------------
# Distance primitive
# ---------------------------------------------------------------------------

def test_haversine_is_zero_for_a_point_against_itself() -> None:
    assert haversine_km(10.7, 122.5, 10.7, 122.5) == pytest.approx(0.0, abs=1e-9)


def test_haversine_is_symmetric() -> None:
    a, b = (10.70, 122.56), (11.43, 123.09)
    assert haversine_km(*a, *b) == pytest.approx(haversine_km(*b, *a))


def test_haversine_matches_a_known_separation() -> None:
    """One degree of latitude is about 111 km anywhere on the globe."""
    assert haversine_km(10.0, 122.5, 11.0, 122.5) == pytest.approx(111.2, abs=1.0)


# ---------------------------------------------------------------------------
# The reference table
# ---------------------------------------------------------------------------

def test_reference_loads_and_is_populated() -> None:
    pts = load_barangay_points()
    assert pts is not None, "run scripts/build_barangay_points_reference.py"
    assert len(pts) > 1000
    assert {"municipality_canonical", "barangay_raw", "lat", "lon"} <= set(pts.columns)


def test_every_point_lies_inside_iloilo_so_lat_and_lon_are_not_swapped() -> None:
    """THE swap guard. Latitude ~10-12 and longitude ~122-123 are disjoint
    ranges here, so a transposition cannot pass both checks."""
    pts = load_barangay_points()
    assert pts is not None
    assert pts["lat"].between(*LAT_RANGE).all(), "a latitude fell outside Iloilo"
    assert pts["lon"].between(*LON_RANGE).all(), "a longitude fell outside Iloilo"
    # And the two ranges must not overlap, or the guard above proves nothing.
    assert LAT_RANGE[1] < LON_RANGE[0]


def test_each_barangay_key_has_exactly_one_point() -> None:
    pts = load_barangay_points()
    assert pts is not None
    assert not pts.duplicated(subset=["municipality_canonical", "barangay_raw"]).any()


def test_the_ppdo_base_is_itself_inside_iloilo() -> None:
    assert LAT_RANGE[0] <= PPDO_BASE_LAT <= LAT_RANGE[1]
    assert LON_RANGE[0] <= PPDO_BASE_LON <= LON_RANGE[1]
    assert distance_from_base_km(PPDO_BASE_LAT, PPDO_BASE_LON) == pytest.approx(0.0, abs=1e-9)


# ---------------------------------------------------------------------------
# Centroids
# ---------------------------------------------------------------------------

def test_centroids_exist_for_most_of_the_province() -> None:
    cents = municipality_centroids()
    assert len(cents) >= 40
    for name, (lat, lon) in cents.items():
        assert LAT_RANGE[0] <= lat <= LAT_RANGE[1], name
        assert LON_RANGE[0] <= lon <= LON_RANGE[1], name


def test_iloilo_city_has_no_centroid_and_that_is_correct() -> None:
    """Not a gap: Iloilo City is a highly urbanized city outside the Provincial
    Planning and Development Office's remit, so the provincial layer omits it.
    Pinned as a test so a future contributor does not 'fix' it."""
    assert municipality_centroid("Iloilo City") is None


def test_unknown_municipality_returns_none_rather_than_guessing() -> None:
    assert municipality_centroid("Nowhere At All") is None


def test_cluster_centroid_ignores_unlocatable_members() -> None:
    cents = municipality_centroids()
    real = sorted(cents)[0]
    mixed = cluster_centroid([real, "Nowhere At All"])
    assert mixed is not None
    assert mixed == pytest.approx(cents[real])


def test_cluster_centroid_is_none_when_nothing_is_locatable() -> None:
    assert cluster_centroid(["Nowhere At All", "Also Nowhere"]) is None


# ---------------------------------------------------------------------------
# Distance-priced mobilization — the behaviour change D18 is about
# ---------------------------------------------------------------------------

def test_a_farther_cluster_costs_more_than_a_nearer_one() -> None:
    """The whole point of D18: under the previous flat charge these were equal,
    despite North Coastal's centroid sitting ~6x farther from base."""
    from optimization_engine import MUNICIPALITY_CLUSTERS

    members: dict[str, list[str]] = {}
    for municipality, cluster in MUNICIPALITY_CLUSTERS.items():
        members.setdefault(cluster, []).append(municipality)

    costs = cluster_mobilization_costs(members)
    assert costs["North Coastal"] > costs["Central Metro"] * 2, (
        f"distance pricing did not separate a 90 km cluster from a 14 km one: {costs}"
    )
    assert all(c > 0 for c in costs.values())


def test_an_unlocatable_cluster_keeps_the_flat_fallback_not_zero() -> None:
    """Pricing an unlocatable cluster at zero would make it look free and
    attract every visit the solver could fit into it."""
    costs = cluster_mobilization_costs({"Unclustered": ["Nowhere At All"]}, flat_fallback_php=1200.0)
    assert costs["Unclustered"] == pytest.approx(1200.0)


def test_cost_scales_linearly_with_distance() -> None:
    cents = municipality_centroids()
    name = sorted(cents)[0]
    single = cluster_mobilization_costs({"c": [name]}, cost_per_km=10.0)["c"]
    doubled = cluster_mobilization_costs({"c": [name]}, cost_per_km=20.0)["c"]
    assert doubled == pytest.approx(single * 2, rel=1e-6)
    assert not math.isnan(single)
