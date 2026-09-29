"""
MAAGAP — PSA Region VI consumer price indices (Objective 1's economic indicators)
================================================================================
Fetches Western Visayas price inflation from PSA OpenSTAT and writes a monthly
tidy CSV for the feature pipeline.

WHAT WAS AND WAS NOT AVAILABLE
------------------------------------------------------------------------------
The obvious target was a construction-materials price index for Region VI.
OpenSTAT has such indices -- the Construction Materials Retail Price Index
(CMRPI) and Construction Materials Wholesale Price Index (CMWPI) -- but every
one of them is **National Capital Region only**. There is no regional
construction-materials index published for Western Visayas.

That forces a choice between two wrong things: an index that is
construction-specific but describes Metro Manila, or one that describes Western
Visayas but is not construction-specific.

This script takes the second, and narrows it as far as the data allows. The
Consumer Price Index is published by region AND by commodity group, and one of
its groups is materials for dwelling maintenance and repair -- construction
materials, in Western Visayas, monthly. Three series are taken:

    ALL ITEMS                                    general regional inflation
    HOUSING, WATER, ELECTRICITY, GAS AND FUELS   construction-adjacent
    Materials for maintenance/repair of dwelling closest available to
                                                 construction materials

This is a real limitation and belongs in Chapter 3 as one: MAAGAP uses regional
*consumer* price inflation as a proxy for construction cost pressure, because
no regional construction price index exists.

WHY YEAR-ON-YEAR CHANGE RATHER THAN THE INDEX LEVEL
------------------------------------------------------------------------------
Coverage needs 2015-2026, and no single table spans it: the 2012-based series
runs 2012-2021 and the 2018-based series 2018-2026. Their index levels are not
comparable -- each is 100 at its own base year -- so concatenating levels would
introduce a discontinuity at the join that the model would read as a real
economic event.

Year-on-year percentage change is invariant to the base, because the base
cancels in the ratio. Computing YoY *within* each series and then concatenating
produces one continuous, meaningful series across the whole span. It is also
the more sensible feature: what plausibly affects a project is cost pressure
during its execution, not the index level.

Usage
-----
    python scripts/fetch_psa_cpi_region6.py
"""

from __future__ import annotations

import argparse
import logging
import re
import time
from pathlib import Path
from typing import Optional

import pandas as pd
import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("fetch_psa_cpi")

REPO_ROOT = Path(__file__).resolve().parent.parent
BASE_URL = "https://openstat.psa.gov.ph/PXWeb/api/v1/en/DB"
DEFAULT_OUTPUT = REPO_ROOT / "data" / "external" / "psa_region6_cpi_monthly.csv"

# PSA documents 10 requests / 10 seconds; this script makes four.
THROTTLE_SECONDS = 1.5
TIMEOUT = 30

MONTHS = {m: i for i, m in enumerate(
    ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"], start=1)}

# The two tables that between them span 2015-2026, with the Region VI
# geolocation label and the three commodity labels to match on. Labels rather
# than indices: OpenSTAT's positional codes differ per table and are not stable.
TABLES = [
    {
        "key": "2012-based",
        "path": "/2M/PI/CPI/2012/0012M4ACPI1.px",
        "region_label": "Region VI (Western Visayas)",
        "series": {
            "cpi_all_items": "ALL ITEMS",
            "cpi_housing_utilities": "HOUSING, WATER, ELECTRICITY, GAS AND OTHER FUELS",
            "cpi_repair_materials": "Materials for the maintenance and repair of the dwelling (ND)",
        },
    },
    {
        "key": "2018-based",
        "path": "/2M/PI/CPI/2018NEW/0012M4ACP22.px",
        "region_label": "Region VI (Western Visayas)",
        "series": {
            "cpi_all_items": "0 - ALL ITEMS",
            "cpi_housing_utilities": "04 - HOUSING, WATER, ELECTRICITY, GAS, AND OTHER FUELS",
            "cpi_repair_materials": "04.3.1.1 - Materials for the maintenance and repair of the dwelling (ND)",
        },
    },
]


def _match(variable: dict, wanted: str) -> Optional[str]:
    """Resolve a label to its PX-Web value code. Exact match first, then a
    normalized contains -- OpenSTAT pads labels with leading dots to show
    hierarchy and varies punctuation between base years."""
    texts, values = variable["valueTexts"], variable["values"]
    norm = lambda s: "".join(ch for ch in s.upper() if ch.isalnum())
    target = norm(wanted)
    for t, v in zip(texts, values):
        if norm(t) == target:
            return v
    for t, v in zip(texts, values):
        if target in norm(t) or norm(t).endswith(target):
            return v
    return None


def fetch_table(table: dict) -> pd.DataFrame:
    url = BASE_URL + table["path"]
    time.sleep(THROTTLE_SECONDS)
    meta = requests.get(url, timeout=TIMEOUT).json()
    variables = {v["code"]: v for v in meta["variables"]}

    geo_var = next(v for k, v in variables.items() if "eolocation" in k or k.lower() == "region")
    com_var = next(v for k, v in variables.items() if "ommodity" in k)

    region_code = _match(geo_var, table["region_label"])
    if region_code is None:
        raise ValueError(f"{table['key']}: could not resolve {table['region_label']!r}")

    wanted_codes: dict[str, str] = {}
    for name, label in table["series"].items():
        code = _match(com_var, label)
        if code is None:
            raise ValueError(f"{table['key']}: could not resolve commodity {label!r}")
        wanted_codes[code] = name

    query = []
    for code, var in variables.items():
        if var is geo_var:
            sel = {"filter": "item", "values": [region_code]}
        elif var is com_var:
            sel = {"filter": "item", "values": list(wanted_codes)}
        else:
            sel = {"filter": "all", "values": ["*"]}
        query.append({"code": code, "selection": sel})

    time.sleep(THROTTLE_SECONDS)
    # CSV, not json-stat2. OpenSTAT accepts the json-stat2 request and returns a
    # well-formed envelope whose `size` says 9 years x 13 periods -- and a
    # `value` array of length one. The CSV endpoint returns the full matrix for
    # the identical query, so that is what this uses.
    resp = requests.post(
        url, json={"query": query, "response": {"format": "csv"}}, timeout=TIMEOUT
    )
    resp.raise_for_status()

    from io import StringIO

    raw = pd.read_csv(StringIO(resp.content.decode("utf-8-sig")))
    id_cols = [c for c in raw.columns if not re.match(r"^\d{4}\s+\S+$", str(c).strip())]
    value_cols = [c for c in raw.columns if c not in id_cols]
    com_col = next((c for c in id_cols if "ommodity" in c), id_cols[-1])

    long = raw.melt(id_vars=id_cols, value_vars=value_cols,
                    var_name="period_label", value_name="value")

    # "2018 Jan" -> year 2018, month 1. "2018 Ave" is the annual average and is
    # dropped: it is not a month and would distort a monthly YoY.
    parts = long["period_label"].astype(str).str.strip().str.split(r"\s+", n=1, expand=True)
    long["year"] = pd.to_numeric(parts[0], errors="coerce")
    long["month"] = parts[1].str.strip().str[:3].str.title().map(MONTHS)
    long = long[long["year"].notna() & long["month"].notna()].copy()

    # table["series"] maps our column name -> PSA's commodity label. The lookup
    # needs the reverse, keyed on a normalized label.
    norm = lambda x: "".join(ch for ch in str(x).upper() if ch.isalnum())
    lookup = {norm(label): name for name, label in table["series"].items()}
    long["series"] = long[com_col].map(lambda v: lookup.get(norm(v)))
    if long["series"].isna().all():
        # Fall back to a contains match; OpenSTAT pads hierarchy with dots.
        def _fuzzy(v):
            nv = norm(v)
            for lbl_norm, nm in lookup.items():
                if lbl_norm in nv or nv.endswith(lbl_norm):
                    return nm
            return None
        long["series"] = long[com_col].map(_fuzzy)
    long = long[long["series"].notna()].copy()

    long["value"] = pd.to_numeric(long["value"], errors="coerce")
    long["date"] = pd.to_datetime(
        dict(year=long["year"].astype(int), month=long["month"].astype(int), day=1)
    )
    out = long.pivot_table(index="date", columns="series", values="value", aggfunc="first").sort_index()
    logger.info("  %s: %d monthly rows %s..%s | series %s", table["key"], len(out),
                out.index.min().date(), out.index.max().date(), list(out.columns))
    return out


def run(output: Path) -> pd.DataFrame:
    frames = []
    for table in TABLES:
        logger.info("Fetching %s ...", table["key"])
        levels = fetch_table(table)
        # YoY within the series, so the base year cancels.
        yoy = (levels / levels.shift(12) - 1.0) * 100.0
        yoy = yoy.dropna(how="all")
        yoy["source_base"] = table["key"]
        frames.append(yoy)

    old, new = frames[0], frames[1]
    # Prefer the newer base wherever both cover a month.
    combined = pd.concat([old[~old.index.isin(new.index)], new]).sort_index()
    combined.index.name = "date"

    output.parent.mkdir(parents=True, exist_ok=True)
    combined.round(4).to_csv(output)
    logger.warning(
        "Wrote %d monthly rows %s..%s to %s (columns: %s)",
        len(combined), combined.index.min().date(), combined.index.max().date(), output,
        [c for c in combined.columns if c != "source_base"],
    )
    return combined


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = ap.parse_args(argv)
    run(args.output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
