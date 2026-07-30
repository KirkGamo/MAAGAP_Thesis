"""
MAAGAP Data Preprocessing Pipeline — Steps 1-5
================================================================================
Implements the first five steps of the Chapter 3 "Data Collection and
Preparation" protocol, scoped to the PPDO Iloilo Province consolidated Fund
Transfer / Monitoring workbook profiled in the MAAGAP Data Audit Report.

    Step 1  Ingestion & sheet isolation
    Step 2  Type coercion (dates, currency) with per-column failure logging
    Step 3  Entity resolution (fuzzy project-key crosswalk across sheets)
    Step 4  Categorical normalization (STATUS / REMARKS / Municipality)
    Step 5  Project-type classification (Infrastructure vs Non-Infrastructure)

This script is intentionally framework-agnostic: it is a standalone,
CLI-runnable module today, and is designed to be imported as-is by the
FastAPI ML microservice once that layer is scaffolded (see Data Audit
Report, Section 6).

Usage
-----
    python preprocess.py \
        --input "../../data/raw/Copy of 2022 conso Fund Transfer worksheet   (2).xlsx" \
        --output-dir "../../data/processed"

Requires: pandas, numpy, openpyxl, rapidfuzz  (see ml-service/requirements.txt)
================================================================================
"""

from __future__ import annotations

import argparse
import functools
import logging
import re
import sys
import warnings
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

import numpy as np
import pandas as pd

try:
    from rapidfuzz import fuzz, process, utils as rapidfuzz_utils
except ImportError as exc:  # pragma: no cover - fail fast with a clear message
    raise ImportError(
        "rapidfuzz is required for Step 3 (entity resolution). "
        "Install it with: pip install rapidfuzz"
    ) from exc


# ==============================================================================
# Logging configuration
# ==============================================================================

logger = logging.getLogger("maagap.preprocess")


def configure_logging(level: str = "INFO") -> None:
    logging.basicConfig(
        level=getattr(logging, level.upper(), logging.INFO),
        format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
        handlers=[logging.StreamHandler(sys.stdout)],
        force=True,
    )


# ==============================================================================
# Configuration constants
# ==============================================================================

# Sheet names to ingest, mapped to short internal keys. Pivot-table summaries
# (Sheet1, Sheet2) and near-empty/malformed sheets are excluded per the Data
# Audit Report, Section 3.2.
CORE_SHEETS: dict[str, str] = {
    "monitoring": "MONITORING REPORT Con",
    "fund_transfer": "Fund Transfer Con",
    "liquidation": "Liquidation Report Con",
    "nta_monitored": "20% NTA Monitored",
    "sef_monitored": "SEF Monitored",
}

# Minimum required columns per sheet — used to fail fast with a clear error
# if the workbook's structure changes (e.g. a re-export drops/renames a column).
REQUIRED_COLUMNS: dict[str, list[str]] = {
    "monitoring": ["NAME OF PROJECT", "LOCATION", "STATUS", "REMARKS",
                   "AMOUNT (Php)", "DATE RELEASED", "Date  of Completion", "Year"],
    "fund_transfer": ["Name of Project", "Municipality", "Amount", "Status", "Year"],
    "liquidation": ["Name of Project", "Municipality", "Amount Released (Php)",
                    "Year of Fund Transfer"],
}

# Plausible Excel serial-date range (roughly 1927-2064). Numeric values outside
# this window are far more likely to be mistyped literal years (e.g. "2016"
# entered directly into a date column, observed in DATE RELEASED — see Data
# Audit Report Finding DQ-1) than genuine serial dates, so they are treated as
# coercion failures rather than silently misinterpreted.
EXCEL_SERIAL_MIN = 10000
EXCEL_SERIAL_MAX = 60000
EXCEL_EPOCH = pd.Timestamp("1899-12-30")

# Explicit string date formats attempted (in order) when pandas' generic
# parser fails, covering the formats observed across sheets (e.g. "May 2,
# 2023", "3-29-2021", "06/21/2023").
STRING_DATE_FORMATS = (
    "%m/%d/%y", "%m/%d/%Y", "%m-%d-%Y", "%m-%d-%y",
    "%B %d, %Y", "%b %d, %Y", "%Y-%m-%d",
)

# STATUS controlled vocabulary. Keys are lowercase/whitespace-normalized raw
# values; values are the canonical label. Derived from the 278 raw / 238
# normalized distinct values observed in the Data Audit Report (Finding DQ-3).
# This list is illustrative of the pattern, not exhaustive — unmapped values
# are logged (not dropped) so the vocabulary can be extended.
STATUS_LOOKUP: dict[str, str] = {
    "completed": "Completed",
    "completed/ fuctional": "Completed/Functional",
    "completed/ functional": "Completed/Functional",
    "completed/ fuctional.": "Completed/Functional",
    "completed/functional": "Completed/Functional",
    "completed/ function": "Completed/Functional",
    "completed/ funtional": "Completed/Functional",
    "completed/funtional": "Completed/Functional",
    "on-going": "On-going",
    "on going": "On-going",
    "ongoing": "On-going",
    "not implemented": "Not Implemented",
    "not yet implemented": "Not Implemented",
    "for bidding": "For Bidding",
    "for implementation": "For Implementation",
}

# REMARKS controlled vocabulary — liquidation-status proxy.
REMARKS_LOOKUP: dict[str, str] = {
    "liquidated": "Liquidated",
    "unliquidated": "Unliquidated",
    "unliquidated as per office record": "Unliquidated (Office Record)",
    "unliquidated as per office  record": "Unliquidated (Office Record)",
    "unliquidated per office record": "Unliquidated (Office Record)",
    "unliquidated per offce record": "Unliquidated (Office Record)",
    "unliquidated as per offfice record": "Unliquidated (Office Record)",
    "unliquidated based on office list of fund transfer": "Unliquidated (Office Record)",
    "unliquidated/validated": "Unliquidated/Validated",
    "liquidated/validated": "Liquidated/Validated",
    "validated/liquidated": "Liquidated/Validated",
    "validated": "Validated",
    "monitored": "Monitored",
}

# Project-type keyword dictionaries for Step 5 (see Data Audit Report, DQ-7).
#
# NOTE ON MATCHING: keywords below use SPACES, never hyphens/slashes, because
# `classify_project_type` normalizes dashes ("-", "–", "—"), slashes,
# and punctuation to spaces before matching. This was a real bug in the v1
# classifier — "multi-purpose" (hyphen) silently failed to match source rows
# spelled "Multi Purpose" or "Multi – Purpose" (en-dash), which is a large
# share of why the v1 classifier left 54.0% of rows Unclassified. Do not add
# hyphenated variants here; add the space-separated form only.
#
# Expanded from a manual review of a random sample of the 4,688 rows the v1
# classifier left Unclassified (see Data Audit Report follow-up analysis):
# the dominant unclassified clusters were LGU social/civic programs ("Socio
# Cultural Activities", "Fiesta"), furniture/equipment procurement ("Monoblock
# Chairs", "CCTV Camera", "Laptop"), and infra items written without the
# original keyword's exact punctuation ("Rehab." vs "Rehabilitation", "Multi
# – Purpose Hall" vs "multi-purpose").
INFRA_KEYWORDS = [
    "road", "bridge", "building", "street light", "streetlight", "water system",
    "drainage", "concreting", "multi purpose", "school", "construction",
    "rehabilitation", "rehab", "pathway", "footwalk", "fence", "flood control",
    "pavement", "canal", "extension of", "improvement of", "repair of",
    "day care center", "day care", "gym", "court light", "solar street light",
    "solarized street light",
]
NON_INFRA_KEYWORDS = [
    "purchase", "computer", "training", "seminar", "equipment", "supplies",
    "medical mission", "feeding", "livelihood", "sound system", "assistance",
    "capacity building", "workshop", "relief", "scholarship", "uniform",
    "socio cultural", "cultural activities", "monoblock", "chairs", "tables",
    "laptop", "printer", "projector", "cctv", "camera", "grass cutter",
    "radio", "trapal", "honorarium", "procurement of", "fiesta", "covid",
    "prizes",
]

# Standard duration thresholds (days), per Chapter 3 "Target Variable
# Construction" (added during manuscript reconciliation).
STANDARD_DURATION_DAYS = {
    "Infrastructure": 365,
    "Non-Infrastructure": 182,
}

FUZZY_SCORE_CUTOFF_DEFAULT = 82

# Year window (in years) tolerated when linking across sheets. Fund release,
# liquidation, and field-monitoring events for the same physical project can
# legitimately be recorded in different calendar years (e.g. a project funded
# in 2019 might not be field-monitored until 2021), so blocking strictly on
# an exact matching year — the v1 approach — discarded a large share of
# genuine matches. This tolerance is applied as a post-match filter, not a
# blocking key (see fuzzy_link_cascading).
YEAR_TOLERANCE_DEFAULT = 2

# Reference list of Iloilo Province LGUs (42 municipalities + Iloilo City and
# Passi City), used to canonicalize the free-text Municipality/LOCATION
# fields before they are used as an entity-resolution blocking key. Blocking
# on the raw, unstandardized municipality string (144 distinct spellings
# observed for ~44 real LGUs — Data Audit Report Finding DQ-3) silently
# fragments true matches across near-duplicate spellings.
MUNICIPALITY_REFERENCE = [
    "Ajuy", "Alimodian", "Anilao", "Badiangan", "Balasan", "Banate",
    "Barotac Nuevo", "Barotac Viejo", "Batad", "Bingawan", "Cabatuan",
    "Calinog", "Carles", "Concepcion", "Dingle", "Dueñas", "Dumangas",
    "Estancia", "Guimbal", "Igbaras", "Iloilo City", "Janiuay", "Lambunao",
    "Leganes", "Lemery", "Leon", "Maasin", "Miagao", "Mina", "New Lucena",
    "Oton", "Passi City", "Pavia", "Pototan", "San Dionisio", "San Enrique",
    "San Joaquin", "San Miguel", "San Rafael", "Santa Barbara", "Sara",
    "Tigbauan", "Tubungan", "Zarraga",
]
MUNICIPALITY_CANONICALIZATION_CUTOFF = 80


# ==============================================================================
# Diagnostic report data classes
# ==============================================================================

@dataclass
class ColumnCoercionReport:
    sheet: str
    column: str
    total: int
    failed: int

    @property
    def failure_rate(self) -> float:
        return (self.failed / self.total * 100.0) if self.total else 0.0

    def __str__(self) -> str:
        return (f"[{self.sheet}] {self.column!r}: "
                f"{self.failed}/{self.total} failed to coerce ({self.failure_rate:.1f}%)")


@dataclass
class PipelineReport:
    coercion: list[ColumnCoercionReport] = field(default_factory=list)
    unmapped_categoricals: dict[str, set] = field(default_factory=dict)
    entity_resolution_pairs: dict[str, int] = field(default_factory=dict)
    project_type_coverage: Optional[dict] = None

    def log_summary(self) -> None:
        logger.info("=" * 78)
        logger.info("PIPELINE DIAGNOSTIC SUMMARY")
        logger.info("=" * 78)
        logger.info("-- Step 2: Type coercion --")
        for r in self.coercion:
            logger.info("  %s", r)
        logger.info("-- Step 3: Entity resolution --")
        for pair_name, count in self.entity_resolution_pairs.items():
            logger.info("  %s: %d matched pairs", pair_name, count)
        logger.info("-- Step 4: Categorical normalization (unmapped values) --")
        for col, values in self.unmapped_categoricals.items():
            if values:
                logger.warning(
                    "  %s: %d distinct unmapped values (sample: %s)",
                    col, len(values), list(values)[:5],
                )
            else:
                logger.info("  %s: all values mapped", col)
        if self.project_type_coverage:
            logger.info("-- Step 5: Project-type classification --")
            for label, pct in self.project_type_coverage.items():
                logger.info("  %s: %.1f%%", label, pct)
        logger.info("=" * 78)


# ==============================================================================
# STEP 1 — Ingestion & sheet isolation
# ==============================================================================

def load_core_sheets(workbook_path: Path) -> dict[str, pd.DataFrame]:
    """
    Load the raw transactional/monitoring sheets from the consolidated
    workbook, skipping PivotTable summaries and near-empty sheets (Data Audit
    Report, Section 3.2).

    Raises
    ------
    FileNotFoundError
        If the workbook does not exist at the given path.
    ValueError
        If a required sheet or required column is missing, so structural
        drift in the source workbook fails loudly rather than silently.
    """
    if not workbook_path.exists():
        raise FileNotFoundError(f"Workbook not found at: {workbook_path}")

    logger.info("Step 1: loading workbook %s", workbook_path.name)
    sheets: dict[str, pd.DataFrame] = {}

    for key, sheet_name in CORE_SHEETS.items():
        try:
            df = pd.read_excel(workbook_path, sheet_name=sheet_name, header=0)
        except ValueError as exc:
            raise ValueError(
                f"Expected sheet '{sheet_name}' (key='{key}') not found in workbook. "
                f"The source file structure may have changed."
            ) from exc
        except Exception as exc:
            raise RuntimeError(f"Failed to read sheet '{sheet_name}': {exc}") from exc

        # Some source sheets carry a leftover column whose header cell was
        # "cleared" in Excel by typing/pasting spaces rather than truly
        # deleting it (observed on MONITORING REPORT Con: a whitespace-only
        # header immediately left of "No.", holding a near-duplicate row
        # index). pandas reads that as a real, non-null column name, so it
        # survives dropna(how="all") and silently rides into the modeling
        # feature set as an arbitrary numeric ID -- a genuine data-leakage
        # risk, not just a cosmetic issue. Strip whitespace-only headers to
        # an explicit empty string here so they can be dropped uniformly.
        df.columns = [c.strip() if isinstance(c, str) else c for c in df.columns]
        blank_header_cols = [c for c in df.columns if isinstance(c, str) and c == ""]
        if blank_header_cols:
            logger.warning(
                "Sheet '%s': dropping %d column(s) with a blank/whitespace-only "
                "header (likely a stray row-index column) — %s",
                sheet_name, len(blank_header_cols), blank_header_cols,
            )
            df = df.drop(columns=blank_header_cols)

        # Drop fully-empty columns/rows introduced by merged header cells.
        df = df.dropna(axis=1, how="all").dropna(axis=0, how="all")

        required = REQUIRED_COLUMNS.get(key, [])
        missing = [c for c in required if c not in df.columns]
        if missing:
            raise ValueError(
                f"Sheet '{sheet_name}' is missing required column(s) {missing}. "
                f"Available columns: {list(df.columns)}"
            )

        sheets[key] = df.reset_index(drop=True)
        logger.info("  loaded '%s' -> %d rows, %d cols", sheet_name, *df.shape)

    return sheets


# ==============================================================================
# STEP 1B — Fold in the two supplementary monitoring sheets
# ==============================================================================

# 20% NTA Monitored and SEF Monitored track the same kind of PPDO field-
# monitoring records as MONITORING REPORT Con (same core columns: project
# name, location, amount, status, dates, remarks) under a different fund
# source, but were never joined into the modeling population -- an initial
# gap noted in the methodology report's "Known Limitations" section. Both
# sheets are small (22 and 87 rows respectively, ~1.25% of the combined
# monitoring population) and have minor schema differences from the main
# sheet, harmonized here:
#   - AMOUNT -> AMOUNT (Php); DATE OF COMPLETION -> Date  of Completion
#     (renamed to match the main sheet's exact column names).
#   - Neither sheet has a DATE RELEASED column. NTA's "Funding Source/Year"
#     is too inconsistent to parse reliably (observed values mix genuine
#     funding-source labels with what look like stray Excel date serials
#     and plain date strings — e.g. "20% NTA CY 2022", "45055",
#     "12/25/2023" all appear in the same column). SEF has a CHECK DATE
#     column that might seem like a plausible DATE RELEASED substitute, but
#     a check-issuance date is not verified to mean the same thing as a
#     fund-release date, and assuming so would be the kind of unjustified
#     equivalence this pipeline has deliberately avoided elsewhere (see
#     REMARKS's liquidation-status-not-delay-justification caveat,
#     is_wet_season_release's weather-proxy caveat). DATE RELEASED is left
#     NaN for every row from both sheets and Year is left NaN too (Step 7
#     already imputes Year for the small number of rows missing it from the
#     main sheet); D_start correctly falls back to DATE MONITORED for these
#     rows via construct_target_variable()'s existing fallback.
#   - A `source_sheet` column is added to every row (including the main
#     sheet's) recording which of the three sheets it came from, so this
#     merge is auditable rather than silently blending provenance.
SUPPLEMENTARY_SHEET_COLUMN_RENAMES: dict[str, dict[str, str]] = {
    "nta_monitored": {"NO": "No.", "AMOUNT": "AMOUNT (Php)", "DATE OF COMPLETION": "Date  of Completion"},
    "sef_monitored": {"NO": "No.", "AMOUNT": "AMOUNT (Php)", "DATE OF COMPLETION": "Date  of Completion"},
}
MONITORING_SCHEMA_COLUMNS = [
    "No.", "DATE MONITORED", "NAME OF PROJECT", "LOCATION", "AMOUNT (Php)",
    "DATE RELEASED", "FUNDS RELEASED TO:", "STATUS", "Date  of Completion",
    "REMARKS", "FILE NAME", "Year",
]


def fold_in_supplementary_sheets(sheets: dict[str, pd.DataFrame]) -> dict[str, pd.DataFrame]:
    """Harmonizes 20% NTA Monitored and SEF Monitored onto MONITORING REPORT
    Con's schema and appends them, so they flow through type coercion,
    entity-resolution crosswalk building, categorical normalization, and
    project-type classification (Steps 2-5) exactly like the main sheet's
    rows -- including a chance at LSTM sequence linkage via the crosswalk,
    which a bolt-on merge after Step 5 would have missed entirely."""
    mon = sheets["monitoring"].copy()
    mon["source_sheet"] = CORE_SHEETS["monitoring"]

    harmonized_parts = [mon]
    for key in ("nta_monitored", "sef_monitored"):
        if key not in sheets:
            continue
        df = sheets[key].copy()
        n_before = len(df)
        df = df[df["NAME OF PROJECT"].notna()].copy()
        n_dropped = n_before - len(df)
        if n_dropped:
            logger.info(
                "Step 1B: dropped %d row(s) from '%s' with no NAME OF PROJECT "
                "(header/unit-label remnants, not real project records)",
                n_dropped, CORE_SHEETS[key],
            )
        df = df.rename(columns=SUPPLEMENTARY_SHEET_COLUMN_RENAMES.get(key, {}))
        for col in MONITORING_SCHEMA_COLUMNS:
            if col not in df.columns:
                df[col] = np.nan
        df = df[MONITORING_SCHEMA_COLUMNS].copy()
        df["source_sheet"] = CORE_SHEETS[key]
        logger.info(
            "Step 1B: folding %d row(s) from '%s' into the monitoring population",
            len(df), CORE_SHEETS[key],
        )
        harmonized_parts.append(df)

    merged = pd.concat(harmonized_parts, ignore_index=True, sort=False)
    logger.info(
        "Step 1B: monitoring population is now %d rows (%d from the main sheet, %d folded in)",
        len(merged), len(mon), len(merged) - len(mon),
    )
    sheets = dict(sheets)
    sheets["monitoring"] = merged
    return sheets


# ==============================================================================
# STEP 2 — Type coercion
# ==============================================================================

# Plausibility bound applied to every successfully-parsed date, regardless of
# which code path produced it. The manuscript's own historical scope is
# 2016-2025 (Chapter 1, Delimitation); this window is deliberately wider to
# tolerate legitimate edge dates without accepting obvious data-entry errors.
# Added after Steps 6/10 testing surfaced a small number of parsed dates
# decades outside this range (e.g. a 2-digit-year string parsed to 1955, and
# another parsed ~60 years into the future) — almost certainly typos, not
# real project dates, and left uncaught by the Excel-serial-range check
# because they arrived as already-formatted strings/datetimes, not raw serials.
PLAUSIBLE_DATE_MIN = pd.Timestamp("2000-01-01")
PLAUSIBLE_DATE_MAX = pd.Timestamp("2030-12-31")


def _coerce_single_date(value) -> pd.Timestamp:
    """Coerce a single mixed-type cell to a pandas Timestamp, or NaT on failure."""
    result = _coerce_single_date_raw(value)
    if pd.notna(result) and not (PLAUSIBLE_DATE_MIN <= result <= PLAUSIBLE_DATE_MAX):
        return pd.NaT  # implausible year (likely a typo) — treated as a coercion failure
    return result


def _coerce_single_date_raw(value) -> pd.Timestamp:
    """Coerce a single mixed-type cell to a pandas Timestamp, or NaT on failure (pre-plausibility-check)."""
    if pd.isna(value):
        return pd.NaT

    if isinstance(value, pd.Timestamp):
        return value

    # datetime.datetime / datetime.date objects (openpyxl returns these for
    # genuinely formatted date cells).
    if hasattr(value, "year") and hasattr(value, "month") and hasattr(value, "day"):
        try:
            return pd.Timestamp(value)
        except (ValueError, OverflowError):
            return pd.NaT

    if isinstance(value, (int, float, np.integer, np.floating)):
        if isinstance(value, float) and not value.is_integer():
            return pd.NaT  # a fractional numeric is not a plausible date cell
        int_value = int(value)
        if EXCEL_SERIAL_MIN <= int_value <= EXCEL_SERIAL_MAX:
            try:
                return EXCEL_EPOCH + pd.Timedelta(days=int_value)
            except (OverflowError, ValueError):
                return pd.NaT
        # Outside the plausible serial range (e.g. a bare "2016" typed as a
        # year) — treated as a coercion failure per Data Audit Report DQ-1,
        # rather than guessed at.
        return pd.NaT

    if isinstance(value, str):
        s = value.strip()
        if not s or s.upper() in ("NA", "N/A"):
            return pd.NaT
        # Try pandas' general parser first. Ambiguous-format warnings are
        # expected given the source data's inconsistent formatting and are
        # suppressed here; the failure/success outcome is what's logged,
        # per-column, by the caller.
        try:
            with warnings.catch_warnings():
                warnings.simplefilter("ignore", UserWarning)
                return pd.to_datetime(s, errors="raise")
        except (ValueError, TypeError):
            pass
        for fmt in STRING_DATE_FORMATS:
            try:
                return pd.to_datetime(s, format=fmt)
            except (ValueError, TypeError):
                continue
        return pd.NaT

    return pd.NaT


def coerce_date_column(series: pd.Series, sheet: str, column: str) -> tuple[pd.Series, ColumnCoercionReport]:
    """Vectorized-per-element date coercion with a per-column failure report."""
    original_notna = series.notna()
    coerced = series.map(_coerce_single_date)
    failed_mask = original_notna & coerced.isna()
    report = ColumnCoercionReport(
        sheet=sheet, column=column,
        total=int(original_notna.sum()), failed=int(failed_mask.sum()),
    )
    return coerced, report


def _coerce_single_currency(value) -> float:
    """Coerce a single mixed-type currency cell to a float, or NaN on failure."""
    if pd.isna(value):
        return np.nan
    if isinstance(value, (int, float, np.integer, np.floating)):
        return float(value)
    s = str(value).strip()
    if not s or s.upper() in ("NA", "N/A"):
        return np.nan
    cleaned = re.sub(r"[^\d.\-]", "", s.replace(",", ""))
    if cleaned in ("", "-", ".", "-."):
        return np.nan
    try:
        return float(cleaned)
    except ValueError:
        return np.nan


def coerce_currency_column(series: pd.Series, sheet: str, column: str) -> tuple[pd.Series, ColumnCoercionReport]:
    """Vectorized-per-element currency coercion with a per-column failure report."""
    original_notna = series.notna()
    coerced = series.map(_coerce_single_currency)
    failed_mask = original_notna & coerced.isna()
    report = ColumnCoercionReport(
        sheet=sheet, column=column,
        total=int(original_notna.sum()), failed=int(failed_mask.sum()),
    )
    return coerced, report


def apply_type_coercion(sheets: dict[str, pd.DataFrame], report: PipelineReport) -> dict[str, pd.DataFrame]:
    """Apply date/currency coercion to the known problem columns in each sheet."""
    logger.info("Step 2: coercing mixed-type date and currency columns")

    date_columns = {
        "monitoring": ["DATE MONITORED", "DATE RELEASED", "Date  of Completion"],
        "fund_transfer": ["Date", "Check Date"],
        "liquidation": ["Date Submitted"],
    }
    currency_columns = {
        "monitoring": ["AMOUNT (Php)"],
        "fund_transfer": ["Amount", "Amount Liquidated", "Balance", "Amount Refunded"],
        "liquidation": ["Amount Released (Php)", "Amount Liquidated (Php)"],
    }

    for key, df in sheets.items():
        for col in date_columns.get(key, []):
            if col in df.columns:
                df[col], col_report = coerce_date_column(df[col], key, col)
                report.coercion.append(col_report)
        for col in currency_columns.get(key, []):
            if col in df.columns:
                df[col], col_report = coerce_currency_column(df[col], key, col)
                report.coercion.append(col_report)

    return sheets


# ==============================================================================
# STEP 3 — Entity resolution (fuzzy project-key crosswalk)
# ==============================================================================

def _normalize_text(value) -> str:
    return re.sub(r"\s+", " ", str(value or "").strip().lower())


@functools.lru_cache(maxsize=4096)
def canonicalize_municipality(raw: str) -> str:
    """
    Map a free-text municipality/location string to its nearest match in
    MUNICIPALITY_REFERENCE via RapidFuzz, so that "Lambunao", "LAMBUNAO ",
    and "Lambunao, Iloilo" all collapse to the same canonical blocking key
    (Data Audit Report Finding DQ-3: 144 distinct raw municipality strings
    observed for ~44 real LGUs). Falls back to a title-cased, whitespace-
    collapsed version of the input when no reference name scores above the
    cutoff, so unrecognized text degrades gracefully rather than raising.
    Results are cached (`lru_cache`) since the same handful of strings recur
    across tens of thousands of rows.

    `processor=rapidfuzz_utils.default_process` is deliberate, not a
    default left in place -- without it, `cleaned` (already lowercased by
    `_normalize_text`) was being compared character-for-character against
    MUNICIPALITY_REFERENCE's Title Case entries with no case folding of
    ITS side, which silently cost 10-15 WRatio points on every comparison
    (e.g. "sta. barbara" vs "Santa Barbara" scored only 72 -- below the 80
    cutoff -- but 88 once both sides are case/punctuation-normalized the
    same way). That gap was large enough to push many genuinely-correct
    matches (abbreviations like "Sta."/"Sto.", hyphens in "Miag-ao", stray
    periods in "Elem.Sch.") below the cutoff and into "Unmapped" even
    though the right municipality was clearly the best candidate.
    `default_process` also strips punctuation and extra whitespace, which
    is exactly the additional normalization that recovers those cases.
    """
    cleaned = _normalize_text(raw)
    if not cleaned:
        return ""
    result = process.extractOne(
        cleaned, MUNICIPALITY_REFERENCE, scorer=fuzz.WRatio,
        processor=rapidfuzz_utils.default_process,
        score_cutoff=MUNICIPALITY_CANONICALIZATION_CUTOFF,
    )
    if result is not None:
        return result[0]
    return cleaned.title()


def fuzzy_link_cascading(
    left: pd.DataFrame,
    right: pd.DataFrame,
    *,
    name_left: str,
    name_right: str,
    muni_left: str,
    muni_right: str,
    year_left: str,
    year_right: str,
    id_left: str,
    id_right: str,
    score_cutoff: int = FUZZY_SCORE_CUTOFF_DEFAULT,
    year_tolerance: int = YEAR_TOLERANCE_DEFAULT,
) -> pd.DataFrame:
    """
    Cascading entity-resolution linker between two transactional sheets:

    Pass 1 (exact): rows whose (normalized project name, canonical
    municipality, fiscal year) triple is byte-identical on both sides are
    linked immediately at score=100, method='exact', and removed from
    consideration for Pass 2. This is fast and has no false-positive risk.

    Pass 2 (fuzzy): remaining rows are blocked by CANONICAL MUNICIPALITY ONLY
    (not year — see YEAR_TOLERANCE_DEFAULT's comment for why year is
    unreliable as a hard block across sheets that record different lifecycle
    stages of the same project). Within each municipality block, RapidFuzz's
    token_sort_ratio finds the best-matching project name above
    `score_cutoff`, and the match is kept only if the two records' fiscal
    years are within `year_tolerance` of each other (or either year is
    missing, in which case the match is kept but flagged).

    This two-pass, municipality-canonicalized, year-tolerant design is the
    fix for the v1 crosswalk's 18.2% linkage rate, which was suppressed by
    (a) blocking on raw/unstandardized municipality strings and (b) requiring
    an exact year match between sheets that legitimately record different
    calendar years for the same project's lifecycle events.

    Returns a DataFrame with columns [left_id, right_id, match_score,
    match_method, municipality_block, year_left, year_right]. Blocks that
    raise unexpected errors are logged and skipped rather than aborting the
    run.
    """
    L = left.copy()
    R = right.copy()
    L["_name"] = L[name_left].map(_normalize_text)
    L["_muni"] = L[muni_left].map(canonicalize_municipality)
    L["_year"] = pd.to_numeric(L[year_left], errors="coerce")
    R["_name"] = R[name_right].map(_normalize_text)
    R["_muni"] = R[muni_right].map(canonicalize_municipality)
    R["_year"] = pd.to_numeric(R[year_right], errors="coerce")

    matches = []

    # --- Pass 1: exact composite-key match -----------------------------
    L["_exact_key"] = list(zip(L["_name"], L["_muni"], L["_year"]))
    R["_exact_key"] = list(zip(R["_name"], R["_muni"], R["_year"]))
    right_by_exact_key: dict = {}
    for ridx, key in zip(R.index, R["_exact_key"]):
        right_by_exact_key.setdefault(key, []).append(ridx)

    matched_left_idx = set()
    matched_right_idx = set()
    for lidx, key in zip(L.index, L["_exact_key"]):
        if not key[0] or not key[1] or pd.isna(key[2]):
            continue
        candidates = [r for r in right_by_exact_key.get(key, []) if r not in matched_right_idx]
        if candidates:
            ridx = candidates[0]
            matches.append({
                "left_id": L.at[lidx, id_left], "right_id": R.at[ridx, id_right],
                "match_score": 100, "match_method": "exact",
                "municipality_block": L.at[lidx, "_muni"],
                "year_left": L.at[lidx, "_year"], "year_right": R.at[ridx, "_year"],
            })
            matched_left_idx.add(lidx)
            matched_right_idx.add(ridx)

    # --- Pass 2: fuzzy match on remaining rows, blocked by municipality -
    L_remaining = L.loc[~L.index.isin(matched_left_idx)]
    R_remaining = R.loc[~R.index.isin(matched_right_idx)]
    right_groups = R_remaining.groupby("_muni").groups
    left_groups = L_remaining.groupby("_muni").groups

    skipped_blocks = 0
    for muni, left_idx in left_groups.items():
        if not muni or muni not in right_groups:
            continue
        try:
            right_idx = right_groups[muni]
            right_block = R_remaining.loc[right_idx].reset_index(drop=True)
            choices = right_block["_name"].tolist()
            if not choices:
                continue
            for li in left_idx:
                query = L.at[li, "_name"]
                if not query:
                    continue
                result = process.extractOne(
                    query, choices, scorer=fuzz.token_sort_ratio, score_cutoff=score_cutoff
                )
                if result is None:
                    continue
                _, score, pos = result
                ly = L.at[li, "_year"]
                ry = right_block.at[pos, "_year"]
                if pd.notna(ly) and pd.notna(ry) and abs(ly - ry) > year_tolerance:
                    continue  # candidate rejected: years too far apart to be the same project
                matches.append({
                    "left_id": L.at[li, id_left],
                    "right_id": right_block.at[pos, id_right],
                    "match_score": score, "match_method": "fuzzy",
                    "municipality_block": muni, "year_left": ly, "year_right": ry,
                })
        except Exception as exc:  # defensive: one bad block must not kill the run
            skipped_blocks += 1
            logger.warning("  skipped block (muni=%s) due to error: %s", muni, exc)
            continue

    if skipped_blocks:
        logger.warning("  %d block(s) skipped during fuzzy linking", skipped_blocks)

    return pd.DataFrame(
        matches,
        columns=["left_id", "right_id", "match_score", "match_method",
                  "municipality_block", "year_left", "year_right"],
    )


def build_project_crosswalk(
    sheets: dict[str, pd.DataFrame], report: PipelineReport,
    score_cutoff: int = FUZZY_SCORE_CUTOFF_DEFAULT,
    year_tolerance: int = YEAR_TOLERANCE_DEFAULT,
) -> pd.DataFrame:
    """
    Constructs a project-key crosswalk linking Fund Transfer Con (the funding
    origin / hub sheet) to Liquidation Report Con and MONITORING REPORT Con,
    addressing Data Audit Report Finding DQ-4 (no shared key across sheets).
    """
    logger.info("Step 3: building entity-resolution crosswalk (cascading exact -> fuzzy match)")

    ft = sheets["fund_transfer"].reset_index().rename(columns={"index": "ft_row_id"})
    liq = sheets["liquidation"].reset_index().rename(columns={"index": "liq_row_id"})
    mon = sheets["monitoring"].reset_index().rename(columns={"index": "mon_row_id"})

    # MONITORING REPORT Con stores location as a single "Barangay, Municipality"
    # string; approximate the municipality as the text after the last comma.
    mon["municipality_proxy"] = mon["LOCATION"].astype(str).map(lambda s: s.split(",")[-1])

    ft_liq = fuzzy_link_cascading(
        ft, liq,
        name_left="Name of Project", name_right="Name of Project",
        muni_left="Municipality", muni_right="Municipality",
        year_left="Year", year_right="Year of Fund Transfer",
        id_left="ft_row_id", id_right="liq_row_id",
        score_cutoff=score_cutoff, year_tolerance=year_tolerance,
    ).rename(columns={"left_id": "ft_row_id", "right_id": "liq_row_id", "match_score": "ft_liq_score",
                       "match_method": "ft_liq_method"})

    ft_mon = fuzzy_link_cascading(
        ft, mon,
        name_left="Name of Project", name_right="NAME OF PROJECT",
        muni_left="Municipality", muni_right="municipality_proxy",
        year_left="Year", year_right="Year",
        id_left="ft_row_id", id_right="mon_row_id",
        score_cutoff=score_cutoff, year_tolerance=year_tolerance,
    ).rename(columns={"left_id": "ft_row_id", "right_id": "mon_row_id", "match_score": "ft_mon_score",
                       "match_method": "ft_mon_method"})

    for label, df_matches in (("fund_transfer<->liquidation", ft_liq), ("fund_transfer<->monitoring", ft_mon)):
        report.entity_resolution_pairs[label] = len(df_matches)
        if len(df_matches):
            method_col = "ft_liq_method" if "ft_liq_method" in df_matches.columns else "ft_mon_method"
            exact_n = int((df_matches[method_col] == "exact").sum())
            logger.info("  %s: %d matched (%d exact, %d fuzzy)", label, len(df_matches), exact_n, len(df_matches) - exact_n)

    crosswalk = ft[["ft_row_id"]].merge(
        ft_liq[["ft_row_id", "liq_row_id", "ft_liq_score", "ft_liq_method"]], on="ft_row_id", how="left"
    ).merge(
        ft_mon[["ft_row_id", "mon_row_id", "ft_mon_score", "ft_mon_method"]], on="ft_row_id", how="left"
    )
    crosswalk.insert(0, "project_key", "PRJ_" + crosswalk["ft_row_id"].astype(str))

    matched_any = crosswalk[["liq_row_id", "mon_row_id"]].notna().any(axis=1).sum()
    logger.info(
        "  crosswalk built: %d fund-transfer rows, %d linked to at least one "
        "liquidation/monitoring record (%.1f%%)",
        len(crosswalk), matched_any, matched_any / len(crosswalk) * 100 if len(crosswalk) else 0,
    )
    return crosswalk


# ==============================================================================
# STEP 4 — Categorical normalization
# ==============================================================================

def normalize_categorical(
    series: pd.Series, lookup: dict[str, str], column_name: str, report: PipelineReport
) -> pd.Series:
    """
    Normalize a free-text categorical column to a controlled vocabulary.

    Values not found in `lookup` are NOT silently dropped or forced into a
    guessed bucket: they fall back to a title-cased version of the normalized
    string, and are recorded in `report.unmapped_categoricals` for manual
    review and lookup-table extension (Data Audit Report Finding DQ-3).
    """
    unmapped: set[str] = set()

    def _map(value) -> Optional[str]:
        if pd.isna(value):
            return np.nan
        normalized = re.sub(r"\s+", " ", str(value).strip().lower())
        if normalized in lookup:
            return lookup[normalized]
        unmapped.add(normalized)
        return normalized.title()

    result = series.map(_map)
    report.unmapped_categoricals[column_name] = unmapped
    return result


def apply_categorical_normalization(sheets: dict[str, pd.DataFrame], report: PipelineReport) -> dict[str, pd.DataFrame]:
    """Apply controlled-vocabulary normalization to STATUS, REMARKS, and Municipality/Location fields."""
    logger.info("Step 4: normalizing categorical fields to controlled vocabularies")

    mon = sheets["monitoring"]
    if "STATUS" in mon.columns:
        mon["STATUS_clean"] = normalize_categorical(mon["STATUS"], STATUS_LOOKUP, "monitoring.STATUS", report)
    if "REMARKS" in mon.columns:
        mon["REMARKS_clean"] = normalize_categorical(mon["REMARKS"], REMARKS_LOOKUP, "monitoring.REMARKS", report)

    ft = sheets["fund_transfer"]
    if "Municipality" in ft.columns:
        ft["Municipality_clean"] = ft["Municipality"].map(
            lambda s: re.sub(r"\s+", " ", str(s or "").strip().title())
        )

    liq = sheets["liquidation"]
    if "Municipality" in liq.columns:
        liq["Municipality_clean"] = liq["Municipality"].map(
            lambda s: re.sub(r"\s+", " ", str(s or "").strip().title())
        )

    return sheets


# ==============================================================================
# STEP 5 — Project-type classification
# ==============================================================================

_DASH_OR_SLASH_RE = re.compile(r"[-–—/,.]")
_MULTISPACE_RE = re.compile(r"\s+")


def _normalize_project_name_for_matching(name: str) -> str:
    """
    Normalize a project name for keyword matching: lowercase, convert dashes
    (hyphen/en-dash/em-dash), slashes, commas, and periods to spaces, and
    collapse whitespace. This is what makes "Multi-Purpose", "Multi Purpose",
    and "Multi – Purpose Hall" all match the same "multi purpose" keyword —
    see the note above INFRA_KEYWORDS for why this was necessary.
    """
    text = _DASH_OR_SLASH_RE.sub(" ", name.lower())
    return _MULTISPACE_RE.sub(" ", text).strip()


def classify_project_type(name: str) -> str:
    """
    Classify a single project name as 'Infrastructure', 'Non-Infrastructure',
    or 'Unclassified' via keyword dictionaries (Data Audit Report Finding
    DQ-7). This is an improved heuristic (v2), not a final classifier — see
    the Data Audit Report's recommendation to train a supervised text
    classifier on a hand-labeled sample once volume allows.
    """
    if not isinstance(name, str) or not name.strip():
        return "Unclassified"
    text = _normalize_project_name_for_matching(name)
    is_infra = any(kw in text for kw in INFRA_KEYWORDS)
    is_non_infra = any(kw in text for kw in NON_INFRA_KEYWORDS)
    if is_infra and not is_non_infra:
        return "Infrastructure"
    if is_non_infra and not is_infra:
        return "Non-Infrastructure"
    return "Unclassified"  # ambiguous (both matched) or unmatched (neither matched)


def apply_project_type_classification(sheets: dict[str, pd.DataFrame], report: PipelineReport) -> dict[str, pd.DataFrame]:
    """Classify project type on the monitoring sheet and record coverage statistics."""
    logger.info("Step 5: classifying project type (Infrastructure vs. Non-Infrastructure)")

    mon = sheets["monitoring"]
    mon["project_type"] = mon["NAME OF PROJECT"].map(classify_project_type)

    coverage = (mon["project_type"].value_counts(normalize=True) * 100).to_dict()
    report.project_type_coverage = coverage
    for label, pct in coverage.items():
        logger.info("  %s: %.1f%% of monitoring rows", label, pct)

    return sheets


# ==============================================================================
# Orchestration
# ==============================================================================

def run_pipeline(
    input_path: Path, output_dir: Path,
    fuzzy_score_cutoff: int = FUZZY_SCORE_CUTOFF_DEFAULT,
    year_tolerance: int = YEAR_TOLERANCE_DEFAULT,
) -> PipelineReport:
    """Run Steps 1-5 end-to-end and persist intermediate artifacts to `output_dir`."""
    report = PipelineReport()
    output_dir.mkdir(parents=True, exist_ok=True)

    sheets = load_core_sheets(input_path)
    sheets = fold_in_supplementary_sheets(sheets)
    sheets = apply_type_coercion(sheets, report)
    crosswalk = build_project_crosswalk(sheets, report, score_cutoff=fuzzy_score_cutoff, year_tolerance=year_tolerance)
    sheets = apply_categorical_normalization(sheets, report)
    sheets = apply_project_type_classification(sheets, report)

    # Persist artifacts for downstream steps (imputation, outlier handling,
    # feature engineering — Steps 6 onward).
    crosswalk.to_csv(output_dir / "project_crosswalk.csv", index=False)
    for key, df in sheets.items():
        df.to_csv(output_dir / f"{key}_cleaned.csv", index=False)
    logger.info("Artifacts written to %s", output_dir.resolve())

    report.log_summary()
    return report


def parse_args(argv: Optional[list[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="MAAGAP data preprocessing pipeline (Steps 1-5)."
    )
    parser.add_argument(
        "--input", type=Path, required=True,
        help="Path to the consolidated PPDO workbook (.xlsx).",
    )
    parser.add_argument(
        "--output-dir", type=Path, default=Path("data/processed"),
        help="Directory to write cleaned CSVs and the project crosswalk to.",
    )
    parser.add_argument(
        "--fuzzy-score-cutoff", type=int, default=FUZZY_SCORE_CUTOFF_DEFAULT,
        help="Minimum RapidFuzz token_sort_ratio score (0-100) to accept an entity-resolution match.",
    )
    parser.add_argument(
        "--year-tolerance", type=int, default=YEAR_TOLERANCE_DEFAULT,
        help="Max years apart two records may be while still being considered the same project during fuzzy linking.",
    )
    parser.add_argument(
        "--log-level", type=str, default="INFO",
        choices=["DEBUG", "INFO", "WARNING", "ERROR"],
    )
    return parser.parse_args(argv)


def main(argv: Optional[list[str]] = None) -> int:
    args = parse_args(argv)
    configure_logging(args.log_level)
    try:
        run_pipeline(args.input, args.output_dir, args.fuzzy_score_cutoff, args.year_tolerance)
    except (FileNotFoundError, ValueError) as exc:
        logger.error("Pipeline aborted: %s", exc)
        return 1
    except Exception:  # pragma: no cover - unexpected failure, full traceback for debugging
        logger.exception("Pipeline failed with an unexpected error.")
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
