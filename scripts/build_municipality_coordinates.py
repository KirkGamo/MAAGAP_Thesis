"""
MAAGAP — Generate the frontend's municipality coordinate table from LMB data
================================================================================
Writes `frontend/src/lib/municipality-coordinates.ts` from the committed LMB
barangay point reference, so the map and the optimizer place a municipality in
the same place.

WHY THIS EXISTS
------------------------------------------------------------------------------
The frontend table was hand-maintained "general-knowledge approximate"
coordinates, and its own docstring asked to be replaced:

    "NOT surveyed centroids from an authoritative source (PSGC, a GIS
     shapefile, or a geocoding API) ... should be verified/replaced with
     PSGC-sourced coordinates before this map is used for anything requiring
     precise geographic accuracy."

D18 supplied that source -- 1,342 LMB barangay points across 43 municipalities,
from PPDO's own GIS export -- but only the backend adopted it. That left two
sources of truth for the same quantity, and they disagreed:

    median 5.81 km     mean 8.23 km     worst 43.91 km (San Rafael)

A 44 km error places a project pin in the wrong part of the province on a map
managers use to decide where to send inspectors.

Generating the file removes the second source rather than correcting it, which
is the only fix that stays fixed: a hand-maintained mirror drifts again the
moment someone edits one side.

ILOILO CITY is the one entry not derived from LMB. It is a highly urbanized
city administratively outside PPDO's provincial remit, so the layer carries no
points for it; its approximate coordinate is preserved and flagged in the
generated file.

Usage
-----
    python scripts/build_municipality_coordinates.py
"""

from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "ml-service"))

from common.geography import load_barangay_points, municipality_centroids  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("build_municipality_coordinates")

DEFAULT_OUTPUT = REPO_ROOT / "frontend" / "src" / "lib" / "municipality-coordinates.ts"

# Not in the LMB provincial layer; see the module docstring.
ILOILO_CITY = ("Iloilo City", 10.7202, 122.5621)

HEADER = '''/**
 * Municipality coordinates for Iloilo Province, DERIVED from PPDO's LMB
 * barangay point layer.
 *
 * GENERATED FILE -- do not edit by hand.
 *   Source:    ml-service/data_pipeline/reference/lmb_barangay_points_iloilo.csv
 *   Generator: scripts/build_municipality_coordinates.py
 *
 * Each value is the mean of that municipality's barangay points, which is the
 * same centroid `ml-service/common/geography.py` gives the optimizer. That
 * shared derivation is the point: this table was previously hand-maintained
 * approximate coordinates, and it had drifted from the authoritative data by a
 * median of 5.8 km and as much as 43.9 km (San Rafael) -- far enough to place
 * a pin in the wrong part of the province on a map used to decide where
 * inspectors go.
 *
 * Centroid-level, not survey-grade: a project is placed at its municipality's
 * centre, not its site. Barangay-level siting needs barangay carried through
 * feature_engineering.py, which it currently is not.
 *
 * Iloilo City is the one hand-set entry -- a highly urbanized city outside the
 * Provincial Planning and Development Office's remit, so the provincial layer
 * holds no points for it.
 */

export const MUNICIPALITY_COORDINATES: Record<string, [number, number]> = {
'''

FOOTER = '''};

export const ILOILO_PROVINCE_CENTER: [number, number] = [11.0, 122.65];
export const ILOILO_PROVINCE_DEFAULT_ZOOM = 9;

/** Resolves a canonicalized municipality name to map coordinates, falling
 * back to the province center (with a wider default zoom, handled by the
 * caller) when the municipality is unmapped/unrecognized. */
export function resolveMunicipalityCoordinates(
  municipality: string | null | undefined
): [number, number] {
  if (!municipality) return ILOILO_PROVINCE_CENTER;
  return MUNICIPALITY_COORDINATES[municipality] ?? ILOILO_PROVINCE_CENTER;
}
'''


def build(output: Path) -> int:
    points = load_barangay_points()
    if points is None:
        raise FileNotFoundError(
            "LMB barangay reference not found. Run "
            "scripts/build_barangay_points_reference.py first."
        )

    centroids = municipality_centroids()
    counts = points.groupby("municipality_canonical").size().to_dict()

    rows = []
    for name in sorted(centroids):
        lat, lon = centroids[name]
        rows.append(
            f'  "{name}": [{lat:.6f}, {lon:.6f}], // {counts.get(name, 0)} barangay points\n'
        )
    rows.append(
        f'  "{ILOILO_CITY[0]}": [{ILOILO_CITY[1]:.6f}, {ILOILO_CITY[2]:.6f}], '
        f"// approximate; outside the provincial LMB layer\n"
    )

    output.write_text(HEADER + "".join(rows) + FOOTER, encoding="utf-8")
    logger.warning(
        "Wrote %d municipalities to %s (%d derived from LMB points, 1 hand-set).",
        len(rows), output, len(centroids),
    )
    return len(rows)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    build(ap.parse_args(argv).output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
