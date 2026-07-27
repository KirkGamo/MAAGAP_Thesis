"""
MAAGAP — PSA OpenSTAT Regional Macroeconomic Data Fetcher
============================================================

Fetches Region VI (Western Visayas) time-series indicators from the
Philippine Statistics Authority (PSA) OpenSTAT portal to use as exogenous
features (e.g. construction cost inflation, labor cost trends) alongside
the PPDO Iloilo project-monitoring data.

FACTUAL CORRECTION TO THE ORIGINAL TASK BRIEF
----------------------------------------------
This script was requested as a client for the "OpenSTAT SDMX API." Live
testing against https://openstat.psa.gov.ph confirmed that OpenSTAT is
NOT a native SDMX REST service. It is built on **PX-Web / PC-Axis**
(a Statistics Sweden-originated platform used by many national statistics
offices). The two ecosystems share a similar goal (disseminating official
statistics) but use different query/response contracts:
  - SDMX uses `dataflow`/`datastructure` REST resources and SDMX-JSON/XML.
  - PX-Web uses a folder-style catalog tree (GET) plus a POST'd JSON
    "query" object per table, with px / csv / json / json-stat2 / xlsx
    response formats.
This script talks to the real PX-Web API. Nothing here will work against
a generic SDMX client library — flagging this now so it isn't a surprise
later (e.g. in Chapter 3's data-source documentation).

VERIFIED API FACTS (via live GET requests against the production API)
-----------------------------------------------------------------------
- API root:            https://openstat.psa.gov.ph/PXWeb/api/v1/en/DB
- Category codes matching the three requested focus areas:
    "2M"  -> Prices
    "2G"  -> Mining, Manufacturing, Construction
    "2N"  -> Labor Cost
- Browsing is just nested GETs, e.g. DB/2G/CONS/BGP -> list of table ids.
- A specific table is queried with POST to .../DB/{path...}/{table_id}
  with a JSON body:
      {
        "query": [
          {"code": "Year", "selection": {"filter": "item", "values": ["2023"]}},
          {"code": "Geolocation", "selection": {"filter": "item", "values": ["46"]}},
          ...
        ],
        "response": {"format": "json-stat2"}
      }
  Every variable the table defines must appear in "query" — variables you
  are not filtering on should use {"filter": "all", "values": ["*"]}.
- Rate limit (per official API-Documentation page): 10 requests / 10 sec,
  HTTP 429 if exceeded. This script self-throttles to stay under that.
- IMPORTANT: Geolocation value CODES are per-table sequential position
  indices, not a universal PSGC code. "REGION VI (WESTERN VISAYAS)" is at
  a different numeric position in every table. This script therefore
  resolves the Region VI code dynamically per table by reading that
  table's own metadata and matching the label text — never hard-coded.

**DATASET_ID PLACEHOLDERS** — swap these in as you confirm/expand coverage
---------------------------------------------------------------------------
Pre-filled with real, verified table IDs discovered during API
exploration. The Prices ("2M") table is left as a placeholder because
that category has several subfolders (Price Indices, Retail Prices,
Wholesale Prices, Farmgate/Dealers' Prices, ...) and the single most
relevant table for construction-materials price inflation should be
chosen deliberately — swap in the exact `.px` id once you've picked it.

    **PRICES_DATASET_ID**       = "REPLACE_ME_2M_TABLE_ID.px"   # e.g. a Price Index table under DB/2M/PI
    **CONSTRUCTION_DATASET_ID** = "0022G4GBPC1.px"               # Construction Statistics from Approved Building Permits, 2022-2024
    **LABOR_COST_DATASET_ID**   = "0012N5EAWR0.px"               # Agricultural Wage Rates of Farm Workers

Usage
-----
    python fetch_psa_data.py --output data/external/psa_region6_timeseries.csv

Requires: requests, pandas
"""

from __future__ import annotations

import argparse
import logging
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional

import pandas as pd
import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("fetch_psa_data")

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

BASE_URL = "https://openstat.psa.gov.ph/PXWeb/api/v1/en/DB"

# PSA OpenSTAT top-level category codes (verified live).
CATEGORY_PRICES = "2M"
CATEGORY_CONSTRUCTION = "2G"
CATEGORY_LABOR_COST = "2N"

# Text used to locate the Western Visayas category in each table's
# Geolocation variable. PSA labels this consistently across tables, but we
# match case-insensitively and tolerate minor punctuation variance.
REGION_VI_LABEL_CANDIDATES = (
    "region vi (western visayas)",
    "region vi - western visayas",
    "region vi",
)

# ---- DATASET_ID PLACEHOLDERS ----------------------------------------------
# Full PX-Web path (category/subfolders/table_id) for each dataset of
# interest. Update the placeholder path/id once a specific Prices table
# has been chosen; the Construction and Labor Cost entries are real,
# verified table ids and are usable as-is.

DATASET_CONFIGS: dict[str, dict[str, Any]] = {
    "prices": {
        # **PRICES_DATASET_ID** — placeholder, confirm exact subfolder + table.
        "path": ["2M", "PI"],  # Price Indices subfolder (candidate; verify)
        "table_id": "REPLACE_ME_2M_TABLE_ID.px",
        "series_label": "Prices (Region VI)",
    },
    "construction": {
        # **CONSTRUCTION_DATASET_ID** — verified real table.
        "path": ["2G", "CONS", "BGP"],
        "table_id": "0022G4GBPC1.px",
        "series_label": "Construction Statistics — Approved Building Permits (Region VI)",
    },
    "labor_cost": {
        # **LABOR_COST_DATASET_ID** — verified real table.
        "path": ["2N"],
        "table_id": "0012N5EAWR0.px",
        "series_label": "Labor Cost / Agricultural Wage Rates (Region VI)",
    },
}

REQUEST_TIMEOUT_SECONDS = 30

# ---------------------------------------------------------------------------
# Rate limiting — PSA documents a hard limit of 10 requests / 10 seconds.
# We self-throttle conservatively (max 8 req / 10 sec window) to leave
# headroom for retries without tripping HTTP 429.
# ---------------------------------------------------------------------------


class RateLimiter:
    def __init__(self, max_requests: int = 8, window_seconds: float = 10.0) -> None:
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self._timestamps: list[float] = []

    def wait_if_needed(self) -> None:
        now = time.monotonic()
        self._timestamps = [t for t in self._timestamps if now - t < self.window_seconds]
        if len(self._timestamps) >= self.max_requests:
            sleep_for = self.window_seconds - (now - self._timestamps[0]) + 0.05
            if sleep_for > 0:
                logger.info("Rate limit guard: sleeping %.2fs", sleep_for)
                time.sleep(sleep_for)
        self._timestamps.append(time.monotonic())


_rate_limiter = RateLimiter()


def _get(url: str) -> Any:
    _rate_limiter.wait_if_needed()
    resp = requests.get(url, timeout=REQUEST_TIMEOUT_SECONDS)
    resp.raise_for_status()
    return resp.json()


def _post(url: str, payload: dict[str, Any]) -> Any:
    _rate_limiter.wait_if_needed()
    resp = requests.post(url, json=payload, timeout=REQUEST_TIMEOUT_SECONDS)
    if resp.status_code == 429:
        logger.warning("Received HTTP 429 from PSA OpenSTAT; backing off 10s and retrying once.")
        time.sleep(10)
        _rate_limiter.wait_if_needed()
        resp = requests.post(url, json=payload, timeout=REQUEST_TIMEOUT_SECONDS)
    resp.raise_for_status()
    return resp.json()


def build_table_url(path: list[str], table_id: str) -> str:
    """Build the full PX-Web table URL from category/subfolder path + table id."""
    segments = "/".join(path + [table_id])
    return f"{BASE_URL}/{segments}"


# ---------------------------------------------------------------------------
# Step 1 — fetch table metadata (variables + their value codes/labels)
# ---------------------------------------------------------------------------


def fetch_table_metadata(path: list[str], table_id: str) -> dict[str, Any]:
    """GET a table's metadata: its list of variables, each with codes/valueTexts."""
    url = build_table_url(path, table_id)
    logger.info("Fetching metadata: %s", url)
    return _get(url)


def resolve_region_vi_code(metadata: dict[str, Any]) -> tuple[Optional[str], Optional[str]]:
    """
    Dynamically resolve the Geolocation variable's code and its Region VI
    value code from a table's own metadata. Codes are per-table sequential
    indices — NEVER assume a fixed code across tables.

    Returns (geolocation_variable_code, region_vi_value_code). Either may be
    None if the table has no Geolocation variable or Region VI isn't found
    in its exposed value list (some lightweight metadata responses omit
    long value lists — see `resolve_region_vi_code_from_data` fallback).
    """
    variables = metadata.get("variables", [])
    for var in variables:
        var_text = str(var.get("text", "")).lower()
        var_code = var.get("code", "")
        if "geolocation" in var_text or "geolocation" in var_code.lower() or var_code.lower() in ("region", "geo"):
            values = var.get("values", []) or []
            value_texts = var.get("valueTexts", []) or []
            for code, label in zip(values, value_texts):
                label_norm = str(label).strip().lower()
                if any(candidate in label_norm for candidate in REGION_VI_LABEL_CANDIDATES):
                    return var_code, code
            # Geolocation variable exists but value list wasn't in this
            # metadata payload (some tables omit large valueTexts arrays
            # from the lightweight metadata GET).
            return var_code, None
    return None, None


# ---------------------------------------------------------------------------
# Step 2 — build a query filtered to Region VI and pull the data
# ---------------------------------------------------------------------------


def build_region_vi_query(
    metadata: dict[str, Any],
    geolocation_var_code: Optional[str],
    region_vi_value_code: Optional[str],
) -> list[dict[str, Any]]:
    """
    Build a PX-Web query body that requests every variable in the table,
    filtering Geolocation down to Region VI when a code was resolved, and
    "all" for every other variable (including Geolocation itself, as a
    safety net, if no code could be resolved from metadata — see the
    client-side fallback filter in `fetch_dataset`).
    """
    query: list[dict[str, Any]] = []
    for var in metadata.get("variables", []):
        code = var.get("code")
        if code == geolocation_var_code and region_vi_value_code is not None:
            query.append({"code": code, "selection": {"filter": "item", "values": [region_vi_value_code]}})
        else:
            query.append({"code": code, "selection": {"filter": "all", "values": ["*"]}})
    return query


def fetch_table_data(path: list[str], table_id: str, query: list[dict[str, Any]]) -> dict[str, Any]:
    """POST a query to a table and return the json-stat2 response."""
    url = build_table_url(path, table_id)
    payload = {"query": query, "response": {"format": "json-stat2"}}
    logger.info("Fetching data: %s", url)
    return _post(url, payload)


# ---------------------------------------------------------------------------
# Step 3 — parse JSON-stat2 into a tidy long-format DataFrame
# ---------------------------------------------------------------------------


def parse_json_stat2(payload: dict[str, Any]) -> pd.DataFrame:
    """
    Decode a standard JSON-stat2 dataset object into a tidy long DataFrame
    with one column per dimension (holding the human-readable label) plus
    a "value" column. JSON-stat2 is a stable, documented open standard, so
    this parser is generic and not PSA-specific.
    """
    dataset = payload.get("dataset", payload)  # some wrappers nest under "dataset"
    dimension = dataset["dimension"]
    dim_ids: list[str] = dataset.get("id") or list(dimension.keys())
    sizes: list[int] = dataset.get("size") or [len(dimension[d]["category"]["index"]) for d in dim_ids]
    values: list[Any] = dataset["value"]

    # For each dimension, build an ordered list of (code -> label) matching
    # the dimension's declared index ordering.
    dim_labels: dict[str, list[str]] = {}
    for dim_id in dim_ids:
        cat = dimension[dim_id]["category"]
        index = cat["index"]
        labels = cat.get("label", {})
        if isinstance(index, dict):
            ordered_codes = sorted(index, key=lambda c: index[c])
        else:  # already an ordered list
            ordered_codes = list(index)
        dim_labels[dim_id] = [labels.get(c, c) for c in ordered_codes]

    total = 1
    for s in sizes:
        total *= s
    if total != len(values):
        logger.warning(
            "JSON-stat2 size product (%d) does not match value array length (%d); "
            "parsing as far as possible.",
            total,
            len(values),
        )

    # Mixed-radix unravel: JSON-stat2 orders `value` with the last
    # dimension varying fastest (row-major / C order).
    rows: list[dict[str, Any]] = []
    for flat_idx, val in enumerate(values):
        remainder = flat_idx
        coords: list[int] = [0] * len(dim_ids)
        for pos in range(len(dim_ids) - 1, -1, -1):
            coords[pos] = remainder % sizes[pos]
            remainder //= sizes[pos]
        row = {dim_ids[i]: dim_labels[dim_ids[i]][coords[i]] for i in range(len(dim_ids))}
        row["value"] = val
        rows.append(row)

    return pd.DataFrame(rows)


# ---------------------------------------------------------------------------
# Step 4 — clean a parsed table into a Month/Year-indexed series
# ---------------------------------------------------------------------------


def _find_column(df: pd.DataFrame, *keywords: str) -> Optional[str]:
    for col in df.columns:
        lowered = col.lower()
        if any(k in lowered for k in keywords):
            return col
    return None


def clean_dataset(df: pd.DataFrame, series_label: str) -> pd.DataFrame:
    """
    Reduce a parsed JSON-stat2 long DataFrame down to a clean
    Year/Month/value series tagged with `series_label`, dropping any
    residual Geolocation column (already filtered to Region VI upstream)
    and any non-numeric/aggregate rows.
    """
    df = df.copy()

    geo_col = _find_column(df, "geolocation", "region")
    if geo_col is not None:
        # Belt-and-suspenders: if the query-level filter could not be
        # resolved (metadata omitted Geolocation values), filter here on
        # the returned label text instead.
        import re as _re

        pattern = "|".join(_re.escape(candidate) for candidate in REGION_VI_LABEL_CANDIDATES)
        mask = df[geo_col].astype(str).str.lower().str.contains(pattern, regex=True, na=False)
        if mask.any():
            df = df[mask]
        else:
            logger.warning(
                "Could not confirm Region VI rows via label text for '%s' — "
                "returned data may be unfiltered by geography. Verify the "
                "table's Geolocation values manually.",
                series_label,
            )
        df = df.drop(columns=[geo_col])

    year_col = _find_column(df, "year")
    period_col = _find_column(df, "period", "quarter", "month")

    df["value"] = pd.to_numeric(df["value"], errors="coerce")

    if year_col is not None:
        df = df.rename(columns={year_col: "Year"})
        df["Year"] = pd.to_numeric(df["Year"], errors="coerce")

    if period_col is not None:
        df = df.rename(columns={period_col: "Period"})

    df["series"] = series_label
    return df


def to_monthly_index(df: pd.DataFrame) -> pd.DataFrame:
    """
    Best-effort collapse of a cleaned dataset to a Month/Year-indexed
    frame. PSA tables vary between Annual/Quarterly/Monthly periodicity;
    where only Year (+ optional Annual/Quarterly Period) is available, the
    series is broadcast onto a monthly index so it can be merged 1:1 with
    the monthly PPDO project timeline features.
    """
    if "Year" not in df.columns:
        raise ValueError("Dataset has no resolvable Year dimension — cannot build a time index.")

    rows: list[dict[str, Any]] = []
    for _, row in df.iterrows():
        year = row.get("Year")
        if pd.isna(year):
            continue
        period_text = str(row.get("Period", "Annual")).strip().lower()

        months: list[int]
        if period_text in ("annual", "nan", ""):
            months = list(range(1, 13))
        elif period_text.startswith("q"):
            # e.g. "Q1" -> Jan-Mar
            try:
                q = int("".join(ch for ch in period_text if ch.isdigit()))
                months = [3 * (q - 1) + m for m in (1, 2, 3)]
            except ValueError:
                months = list(range(1, 13))
        else:
            # Try to match a month name/number directly.
            try:
                month_num = pd.to_datetime(period_text, format="%B", errors="raise").month
                months = [month_num]
            except (ValueError, TypeError):
                months = list(range(1, 13))

        for month in months:
            rows.append(
                {
                    "Year": int(year),
                    "Month": month,
                    "series": row.get("series"),
                    "value": row.get("value"),
                }
            )

    monthly = pd.DataFrame(rows).drop_duplicates(subset=["Year", "Month", "series"])
    monthly["date"] = pd.to_datetime(
        dict(year=monthly["Year"], month=monthly["Month"], day=1), errors="coerce"
    )
    return monthly


# ---------------------------------------------------------------------------
# Step 5 — orchestrate fetch -> clean -> monthly-index for one dataset
# ---------------------------------------------------------------------------


@dataclass
class FetchResult:
    series_label: str
    monthly_df: pd.DataFrame
    warnings: list[str] = field(default_factory=list)


def fetch_dataset(key: str, config: dict[str, Any]) -> FetchResult:
    path = config["path"]
    table_id = config["table_id"]
    series_label = config["series_label"]
    warnings: list[str] = []

    if table_id.startswith("REPLACE_ME"):
        msg = (
            f"Dataset '{key}' still has a placeholder table_id ({table_id}); "
            "skipping fetch. Update DATASET_CONFIGS with a real .px table id."
        )
        logger.warning(msg)
        return FetchResult(series_label=series_label, monthly_df=pd.DataFrame(), warnings=[msg])

    metadata = fetch_table_metadata(path, table_id)
    geo_var_code, region_code = resolve_region_vi_code(metadata)

    if geo_var_code is None:
        warnings.append(f"'{series_label}': no Geolocation variable found — table may be national-only.")
    elif region_code is None:
        warnings.append(
            f"'{series_label}': Geolocation variable found but Region VI code could not be "
            "resolved from metadata value list; falling back to client-side label filtering "
            "of the unfiltered pull."
        )

    query = build_region_vi_query(metadata, geo_var_code, region_code)
    raw = fetch_table_data(path, table_id, query)
    parsed = parse_json_stat2(raw)
    cleaned = clean_dataset(parsed, series_label)
    monthly = to_monthly_index(cleaned)

    return FetchResult(series_label=series_label, monthly_df=monthly, warnings=warnings)


# ---------------------------------------------------------------------------
# Step 6 — merge all datasets into one Month/Year-indexed wide DataFrame
# ---------------------------------------------------------------------------


def merge_datasets(results: list[FetchResult]) -> pd.DataFrame:
    """Merge multiple monthly long-format series into one wide time-series
    DataFrame indexed by (Year, Month), one column per series."""
    frames = [r.monthly_df for r in results if not r.monthly_df.empty]
    if not frames:
        logger.warning("No datasets were successfully fetched — returning an empty DataFrame.")
        return pd.DataFrame(columns=["Year", "Month", "date"])

    merged: Optional[pd.DataFrame] = None
    for frame in frames:
        series_name = frame["series"].iloc[0]
        pivoted = frame.pivot_table(
            index=["Year", "Month", "date"], values="value", aggfunc="mean"
        ).rename(columns={"value": series_name})
        merged = pivoted if merged is None else merged.join(pivoted, how="outer")

    merged = merged.reset_index().sort_values(["Year", "Month"]).reset_index(drop=True)
    return merged


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


def run(output_path: str) -> pd.DataFrame:
    results: list[FetchResult] = []
    for key, config in DATASET_CONFIGS.items():
        try:
            result = fetch_dataset(key, config)
            for w in result.warnings:
                logger.warning(w)
            results.append(result)
        except requests.HTTPError as exc:
            logger.error("HTTP error fetching '%s': %s", key, exc)
        except Exception as exc:  # noqa: BLE001 — log and continue with other datasets
            logger.error("Failed to fetch/parse '%s': %s", key, exc)

    merged = merge_datasets(results)

    out_path = Path(output_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    merged.to_csv(out_path, index=False)
    logger.info("Wrote %d rows to %s", len(merged), out_path)
    return merged


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--output",
        default="data/external/psa_region6_timeseries.csv",
        help="Output CSV path for the merged Region VI time-series DataFrame.",
    )
    args = parser.parse_args()
    run(args.output)


if __name__ == "__main__":
    main()
