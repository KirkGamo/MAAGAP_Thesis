"""
MAAGAP — Build the Iloilo barangay coordinate reference from PPDO's GIS export
================================================================================
Extracts the LMB (Land Management Bureau) Iloilo barangay point layer out of
PPDO's ArcGIS export and writes it as a committed reference CSV, in the same
spirit as `reference/psgc_barangays_iloilo.csv`: the data is checked in, and the
pipeline reads it rather than depending on a workbook that lives on one laptop.

SOURCE
------------------------------------------------------------------------------
    T_2026PROJILO26823_layer_TableToExcel.xlsx  (PPDO, received 2026-09)

That workbook is the fund-transfer worksheet spatially joined to the LMB
barangay point layer: 22,383 rows x 52 columns, `FID` unique (the join
duplicated nothing). Its twenty project columns mirror
`data/processed/fund_transfer_cleaned.csv` exactly, so it carries NO new project
data -- it is the existing source re-exported with geometry attached. Only the
geometry is extracted here.

WHY PPDO'S OWN JOIN IS NOT REUSED
------------------------------------------------------------------------------
Their attribute join resolved only 12,419 of 22,383 rows (55%). The failures are
not missing inputs -- exactly 11 rows had a blank source barangay -- they are
unmatched barangay NAMES: "POBLACION", "MUNICIPALITY", "BACAY SK", "TUBURAN-SK",
"P.D. MONFORT SOUTH". That is the same class of problem D13 addressed with
municipality-scoped PSGC canonicalization.

So this script takes only the point layer and lets the pipeline's own matcher do
the joining, against the canonical vocabulary the rest of the project already
uses.

COORDINATE REFERENCE SYSTEM
------------------------------------------------------------------------------
POINT_X / POINT_Y are WGS84 decimal degrees, verified by range: X spans
122.02-123.35 E and Y spans 10.48-11.62 N, which is Iloilo province. They are
written out as `lon` and `lat` respectively, named explicitly so no downstream
consumer has to guess which of X/Y is which -- a mistake that is silent and
produces plausible-looking garbage.

PRECISION CAVEAT
------------------------------------------------------------------------------
These are BARANGAY points, not project sites. A project's true location is
somewhere within its barangay; this reference places it at the barangay's
recorded point. That is a large improvement on assigning it to one of five
hand-drawn provincial clusters, but it is not survey-grade siting, and distance
figures derived from it should be described as barangay-level approximations.

Usage
-----
    python scripts/build_barangay_points_reference.py
"""

from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

import pandas as pd

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "ml-service"))

from data_pipeline.preprocess import canonicalize_municipality  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("build_barangay_points")

DEFAULT_SOURCE = REPO_ROOT / "T_2026PROJILO26823_layer_TableToExcel.xlsx"
DEFAULT_OUTPUT = (
    REPO_ROOT / "ml-service" / "data_pipeline" / "reference" / "lmb_barangay_points_iloilo.csv"
)

# Sanity envelope for Iloilo province, used to reject a CRS surprise loudly
# rather than silently emitting coordinates in the wrong system.
LON_RANGE = (121.5, 123.8)
LAT_RANGE = (10.0, 12.0)


def build(source: Path, output: Path) -> pd.DataFrame:
    if not source.exists():
        raise FileNotFoundError(f"Required input not found: {source}")

    raw = pd.read_excel(source)
    # ArcGIS prefixes every column with its source table; strip it.
    raw.columns = [c.split(".", 1)[1] if "." in c else c for c in raw.columns]

    required = {"BrgyName", "MUN_NAME_1", "POINT_X", "POINT_Y"}
    missing = required - set(raw.columns)
    if missing:
        raise ValueError(f"{source.name} is missing expected LMB columns: {sorted(missing)}")

    pts = (
        raw.dropna(subset=["POINT_X", "POINT_Y", "BrgyName", "MUN_NAME_1"])
        .loc[:, ["MUN_NAME_1", "BrgyName", "district", "POINT_X", "POINT_Y"]]
        .drop_duplicates(subset=["MUN_NAME_1", "BrgyName"])
        .rename(columns={"MUN_NAME_1": "municipality_raw", "BrgyName": "barangay_raw",
                         "POINT_X": "lon", "POINT_Y": "lat"})
        .reset_index(drop=True)
    )

    # A barangay key resolving to two different points would mean the layer
    # carries conflicting geometry; verified absent, asserted so it stays that way.
    dupes = pts.duplicated(subset=["municipality_raw", "barangay_raw"]).sum()
    if dupes:
        raise ValueError(f"{dupes} barangay key(s) carry more than one point")

    out_of_range = pts[
        ~pts["lon"].between(*LON_RANGE) | ~pts["lat"].between(*LAT_RANGE)
    ]
    if len(out_of_range):
        raise ValueError(
            f"{len(out_of_range)} point(s) fall outside Iloilo's envelope — the source "
            f"may not be WGS84 decimal degrees. Sample:\n{out_of_range.head()}"
        )

    pts["municipality_canonical"] = pts["municipality_raw"].map(canonicalize_municipality)
    unresolved = pts["municipality_canonical"].isna() | (
        pts["municipality_canonical"].astype(str).str.strip() == ""
    )
    if unresolved.any():
        logger.warning(
            "%d point(s) whose municipality did not canonicalize are dropped: %s",
            int(unresolved.sum()),
            sorted(pts.loc[unresolved, "municipality_raw"].unique())[:10],
        )
        pts = pts[~unresolved].reset_index(drop=True)

    pts["district"] = pd.to_numeric(pts["district"], errors="coerce").astype("Int64")
    pts = pts[[
        "municipality_canonical", "municipality_raw", "barangay_raw",
        "district", "lat", "lon",
    ]].sort_values(["municipality_canonical", "barangay_raw"]).reset_index(drop=True)

    output.parent.mkdir(parents=True, exist_ok=True)
    pts.to_csv(output, index=False)

    logger.warning(
        "Wrote %d barangay points across %d municipalities to %s",
        len(pts), pts["municipality_canonical"].nunique(), output,
    )
    return pts


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args(argv)
    build(args.source, args.output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
