"""
MAAGAP — Extract PAGASA Iloilo daily weather observations from PDF
================================================================================
Turns PAGASA's monthly observation sheets into two tidy daily CSVs, with a QC
report that must be read before the output is used for anything.

SOURCE
------------------------------------------------------------------------------
    SUMMARY OF DAILY PCPN <year> ILOILO.pdf   — daily rainfall, 2015-2026
    TEMPERATURE OBSERVATION <year>.pdf        — daily min/max temperature, 2016-2026

All from station ILOILO RADAR, index 98637, Jaro, Iloilo (10 deg 46' N,
122 deg 24' E, elevation 33 m). ONE station for the whole province -- see the
caveat at the bottom of this docstring.

FORMAT HAZARDS THIS PARSER DEFENDS AGAINST
------------------------------------------------------------------------------
Each was found by reading the actual files, not anticipated in the abstract:

1. PAGE INDEX DOES NOT GIVE THE MONTH. The 2015 rainfall file's first page is
   February; the 2016 temperature file's first page is May and the file has
   FIFTEEN pages, not twelve. Every page's month is therefore parsed from the
   page itself -- from the table's own month cell for rainfall, and from the
   "For the Month of: <Month> <Year>" line for temperature -- and a page whose
   month cannot be read is reported rather than guessed at.

2. HEADER TEXT DRIFTS BETWEEN YEARS. 2016 prints "24-HR TOTAL" and "2PM";
   2015 prints "24-HOUR TOTAL" and "2:00 pm". Columns are therefore taken
   POSITIONALLY from rows whose first cell is a day number, never by matching
   header strings.

3. BLANK IS NOT ZERO. February's rows 29-31 are empty, and most days genuinely
   record 0 mm of rain. Coercing blank to 0.0 would be invisible in every
   aggregate while quietly inventing dry days. Blanks stay NaN.

4. THE SUM ROW IS A CHECKSUM, NOT A DAY. It is excluded from the daily output
   and retained for validation.

5. PAGASA'S OWN SUB-COLUMN SUMS CONTAIN ERRORS. On January 2016 the printed
   2PM sum is 0 where the column actually totals 6.0, and the 8AM sum is 0
   against an actual 6.6 -- but the 24-HR TOTAL sum of 15.3 is correct, and the
   four sub-readings of each individual day do add to that day's own 24-hour
   total. Validation therefore trusts the 24-hour column and the per-day
   arithmetic, and does NOT check the sub-column sums, which would fail against
   the source's own errors rather than ours.

6. FILENAMES ARE INCONSISTENT. Two carry a trailing space before ".pdf"
   ("...2021 ILOILO .pdf"). The glob is written to tolerate it.

WHAT THE OUTPUT IS AND IS NOT
------------------------------------------------------------------------------
One row per station-day. This is PROVINCIAL weather from a single station, so
it varies by date and never by municipality: two projects running concurrently
at opposite ends of Iloilo receive identical values. It can describe temporal
variation in delay; it cannot distinguish between concurrent projects by
location. Any feature built on it inherits that limit.

Usage
-----
    python scripts/extract_pagasa_pdfs.py
    python scripts/extract_pagasa_pdfs.py --source-dir data/raw/pagasa --output-dir data/external
"""

from __future__ import annotations

import argparse
import json
import logging
import re
from pathlib import Path
from typing import Optional

import pandas as pd
import pdfplumber

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("extract_pagasa")

REPO_ROOT = Path(__file__).resolve().parent.parent

MONTHS = {
    m.upper(): i
    for i, m in enumerate(
        ["January", "February", "March", "April", "May", "June",
         "July", "August", "September", "October", "November", "December"],
        start=1,
    )
}

MONTH_RE = re.compile(r"\b(" + "|".join(MONTHS) + r")\b", re.IGNORECASE)
YEAR_RE = re.compile(r"\b(19|20)\d{2}\b")
TEMP_MONTH_RE = re.compile(r"month\s*of\s*:?\s*([A-Za-z]+)\s*,?\s*((?:19|20)\d{2})", re.IGNORECASE)

# Month names in these sheets are hand-typed and occasionally misspelled --
# TEMPERATURE OBSERVATION 2017 page 3 reads "Febuary2017", missing an 'r' and
# the space before the year. The first three letters are unambiguous across all
# twelve months, so resolve on that prefix rather than demanding exact spelling.
MONTH_BY_PREFIX = {name[:3]: number for name, number in MONTHS.items()}


def _resolve_month(name: object) -> Optional[int]:
    if not name:
        return None
    key = str(name).strip().upper()
    return MONTHS.get(key) or MONTH_BY_PREFIX.get(key[:3])

STATION = "ILOILO RADAR (98637), Jaro, Iloilo"


def _num(cell: object) -> Optional[float]:
    """Parse a reading. Blank stays None (missing), never 0.0. 'T' is the
    meteorological trace marker -- rainfall too small to measure -- recorded as
    0.0 because a trace is a real observation of almost no rain, unlike a blank
    which is an absent observation."""
    if cell is None:
        return None
    s = str(cell).strip()
    if s == "" or s in {"-", "--"}:
        return None
    if s.upper() in {"T", "TR", "TRACE"}:
        return 0.0
    s = s.replace(",", "")
    # PDF text extraction sometimes splits a single reading across a space:
    # July 2015 day 21 comes out as "4 8.0" for a value of 48.0. Taking the
    # first numeric token would silently read that as 4, which is how 87 pages
    # came to fail their own printed checksum on the first run. Rejoin digits
    # separated only by whitespace before parsing.
    s = re.sub(r"(?<=[\d.])\s+(?=[\d.])", "", s)
    m = re.search(r"-?\d+(?:\.\d+)?", s)
    return float(m.group()) if m else None


def _page_month_year(page, table: Optional[list]) -> tuple[Optional[int], Optional[int]]:
    """Month/year for this page, from the page's own content."""
    text = page.extract_text() or ""

    # Temperature sheets print it explicitly.
    m = TEMP_MONTH_RE.search(text)
    if m:
        month = _resolve_month(m.group(1))
        if month:
            return month, int(m.group(2))

    # Rainfall sheets carry the month and year in the table's own header cells.
    if table:
        head = " ".join(
            str(c) for row in table[:4] for c in row if c is not None
        )
        mm = MONTH_RE.search(head)
        yy = YEAR_RE.search(head)
        if mm and yy:
            return MONTHS[mm.group(1).upper()], int(yy.group(0))

    mm = MONTH_RE.search(text)
    yy = YEAR_RE.search(text)
    if mm and yy:
        return MONTHS[mm.group(1).upper()], int(yy.group(0))
    return None, None


def _classify_empty_page(page, table: Optional[list] = None) -> str:
    """
    Why a page yielded no daily rows. The distinction matters: these files
    interleave genuinely blank separator pages and end-of-month statistics
    pages between the daily tables, and counting those as extraction failures
    would bury a real failure among two dozen non-events.

        blank            — no text and no tables at all (e.g. TEMPERATURE
                           OBSERVATION 2016 page 3)
        summary          — a monthly AVERAGE/MEAN/MIN/MAX block rather than a
                           daily table (e.g. TEMPERATURE OBSERVATION 2017 p2)
        unparsed         — has content that looks like data but could not be
                           read. This is the only value that warrants alarm.
    """
    text = (page.extract_text() or "").strip()
    if not text and not table:
        return "blank"
    upper = text.upper()
    if any(k in upper for k in ("AVERAGE", "MEAN:", "MONTHLY SUMMARY")) and not _day_rows(table or []):
        return "summary"
    return "unparsed"


def _day_rows(table: list) -> list[list]:
    """Rows whose first cell is a day number 1-31. Excludes headers and SUM."""
    out = []
    for row in table:
        if not row:
            continue
        first = str(row[0]).strip() if row[0] is not None else ""
        if first.isdigit() and 1 <= int(first) <= 31:
            out.append(row)
    return out


def _sum_row(table: list) -> Optional[list]:
    for row in table:
        if row and row[0] is not None and str(row[0]).strip().upper() == "SUM":
            return row
    return None


# ---------------------------------------------------------------------------
# Precipitation
# ---------------------------------------------------------------------------

def parse_precipitation(path: Path) -> tuple[list[dict], list[dict]]:
    rows: list[dict] = []
    checks: list[dict] = []
    with pdfplumber.open(path) as pdf:
        for pno, page in enumerate(pdf.pages, start=1):
            table = page.extract_table()
            if not table:
                checks.append({
                    "file": path.name, "page": pno,
                    "skipped": _classify_empty_page(page),
                })
                continue
            month, year = _page_month_year(page, table)
            if month is None:
                checks.append({
                    "file": path.name, "page": pno,
                    "skipped": _classify_empty_page(page, table),
                })
                continue

            page_rows = []
            for row in _day_rows(table):
                cells = list(row) + [None] * (7 - len(row))
                day = int(str(cells[0]).strip())
                try:
                    date = pd.Timestamp(year=year, month=month, day=day)
                except ValueError:
                    continue  # e.g. day 31 printed on a 30-day month
                page_rows.append({
                    "date": date.date().isoformat(),
                    "rain_2pm_mm": _num(cells[1]),
                    "rain_8pm_mm": _num(cells[2]),
                    "rain_2am_mm": _num(cells[3]),
                    "rain_8am_mm": _num(cells[4]),
                    "rain_24h_mm": _num(cells[5]),
                    "remarks": (str(cells[6]).strip() if cells[6] else ""),
                    "source_file": path.name,
                    "source_page": pno,
                })
            rows.extend(page_rows)

            # TWO independent checks, because together they say WHOSE fault a
            # mismatch is.
            #
            #   column-wise: do the extracted daily totals add to the page's
            #                own printed SUM?
            #   row-wise:    do each day's four sub-readings add to that same
            #                day's printed 24-hour total?
            #
            # Row-wise passing while column-wise fails means the daily figures
            # were read correctly and the PRINTED SUM is wrong -- which is the
            # case on four pages here, e.g. December 2025, where PAGASA's SUM
            # row doubles both the 2PM column and the 24-hour total while every
            # individual day is internally consistent. Only the reverse
            # (row-wise failing) would implicate this parser.
            sr = _sum_row(table)
            printed = _num(sr[5]) if sr and len(sr) > 5 else None
            actual = sum(r["rain_24h_mm"] or 0.0 for r in page_rows)

            rowwise_bad = 0
            inconsistent_days: list[str] = []
            for r in page_rows:
                parts = [r["rain_2pm_mm"], r["rain_8pm_mm"], r["rain_2am_mm"], r["rain_8am_mm"]]
                if r["rain_24h_mm"] is None or any(v is None for v in parts):
                    continue
                if abs(sum(parts) - r["rain_24h_mm"]) > 0.15:
                    rowwise_bad += 1
                    inconsistent_days.append(r["date"])

            col_ok = printed is not None and abs(printed - actual) <= 0.15
            checks.append({
                "file": path.name, "page": pno, "year": year, "month": month,
                "days": len(page_rows),
                "printed_sum_24h": printed,
                "extracted_sum_24h": round(actual, 2),
                "sum_ok": col_ok,
                "rowwise_mismatches": rowwise_bad,
                "inconsistent_days": inconsistent_days,
                "verdict": (
                    "ok" if col_ok
                    else ("source SUM row disagrees with its own daily rows"
                          if rowwise_bad == 0
                          else "source has internally inconsistent day(s); verify against the page")
                ),
            })
    return rows, checks


# ---------------------------------------------------------------------------
# Temperature
# ---------------------------------------------------------------------------

def parse_temperature(path: Path) -> tuple[list[dict], list[dict]]:
    rows: list[dict] = []
    checks: list[dict] = []
    with pdfplumber.open(path) as pdf:
        for pno, page in enumerate(pdf.pages, start=1):
            tables = page.extract_tables()
            if not tables:
                checks.append({
                    "file": path.name, "page": pno,
                    "skipped": _classify_empty_page(page),
                })
                continue
            table = max(tables, key=len)
            month, year = _page_month_year(page, table)
            if month is None:
                checks.append({
                    "file": path.name, "page": pno,
                    "skipped": _classify_empty_page(page, table),
                })
                continue

            page_rows = []
            for row in _day_rows(table):
                cells = list(row) + [None] * (9 - len(row))
                day = int(str(cells[0]).strip())
                try:
                    date = pd.Timestamp(year=year, month=month, day=day)
                except ValueError:
                    continue
                page_rows.append({
                    "date": date.date().isoformat(),
                    "tmin_c": _num(cells[5]),
                    "tmin_time": (str(cells[6]).strip() if cells[6] else ""),
                    "tmax_c": _num(cells[7]),
                    "tmax_time": (str(cells[8]).strip() if cells[8] else ""),
                    "source_file": path.name,
                    "source_page": pno,
                })
            rows.extend(page_rows)
            observed = [r for r in page_rows if r["tmin_c"] is not None or r["tmax_c"] is not None]
            checks.append({
                "file": path.name, "page": pno, "year": year, "month": month,
                "days": len(page_rows), "days_with_reading": len(observed),
            })
    return rows, checks


# ---------------------------------------------------------------------------
# Orchestration
# ---------------------------------------------------------------------------

def _temperature_flags(temp_df: pd.DataFrame) -> dict:
    """
    Physical plausibility checks on the temperature series. These are REPORTED,
    never corrected: the extraction's job is to reproduce the sheets faithfully,
    and deciding what to do about an impossible reading belongs to feature
    engineering, where the choice can be recorded as a decision.

    Iloilo is tropical and near sea level, so a daily minimum below 18 C or a
    maximum below 25 C is suspect, and tmin exceeding tmax is impossible.
    """
    if temp_df.empty:
        return {}
    tmin, tmax = temp_df["tmin_c"], temp_df["tmax_c"]
    inverted = temp_df[tmin.notna() & tmax.notna() & (tmin > tmax)]
    implausible = temp_df[
        (tmin.notna() & (tmin < 18.0)) | (tmax.notna() & ((tmax < 25.0) | (tmax > 40.0)))
    ]
    return {
        "tmin_exceeds_tmax": {
            "count": int(len(inverted)),
            "dates": [str(d) for d in inverted["date"].tolist()[:20]],
        },
        "outside_plausible_envelope": {
            "count": int(len(implausible)),
            "dates": [str(d) for d in implausible["date"].tolist()[:20]],
        },
        "note": (
            "Reported, not corrected. 2018-12-03 carries tmin=1.0 with no tmax and no "
            "observation time, which is not a credible Iloilo reading."
        ),
    }


def run(source_dir: Path, output_dir: Path) -> dict:
    output_dir.mkdir(parents=True, exist_ok=True)

    # Tolerant globs: two filenames carry a trailing space before the extension.
    pcpn = sorted(p for p in source_dir.glob("SUMMARY OF DAILY PCPN*") if p.suffix.lower() == ".pdf")
    temp = sorted(p for p in source_dir.glob("TEMPERATURE OBSERVATION*") if p.suffix.lower() == ".pdf")
    logger.warning("Found %d precipitation and %d temperature PDFs in %s",
                   len(pcpn), len(temp), source_dir)
    if not pcpn and not temp:
        raise FileNotFoundError(f"No PAGASA PDFs found under {source_dir}")

    rain_rows: list[dict] = []
    rain_checks: list[dict] = []
    for path in pcpn:
        r, c = parse_precipitation(path)
        rain_rows.extend(r)
        rain_checks.extend(c)
        logger.info("  %s -> %d daily rows", path.name, len(r))

    temp_rows: list[dict] = []
    temp_checks: list[dict] = []
    for path in temp:
        r, c = parse_temperature(path)
        temp_rows.extend(r)
        temp_checks.extend(c)
        logger.info("  %s -> %d daily rows", path.name, len(r))

    rain_df = pd.DataFrame(rain_rows).drop_duplicates(subset=["date"], keep="first")
    temp_df = pd.DataFrame(temp_rows).drop_duplicates(subset=["date"], keep="first")
    rain_df = rain_df.sort_values("date").reset_index(drop=True)
    temp_df = temp_df.sort_values("date").reset_index(drop=True)

    rain_path = output_dir / "pagasa_iloilo_precipitation_daily.csv"
    temp_path = output_dir / "pagasa_iloilo_temperature_daily.csv"
    rain_df.to_csv(rain_path, index=False)
    temp_df.to_csv(temp_path, index=False)

    dup_rain = len(rain_rows) - len(rain_df)
    dup_temp = len(temp_rows) - len(temp_df)
    failed = [c for c in rain_checks if c.get("sum_ok") is False]
    # A page can fail its column checksum two ways, and neither implicates the
    # parser on this corpus -- both were verified against the rendered pages:
    #   * the printed SUM row is simply wrong (2025-12 doubles the 2PM column
    #     and the 24-hour total while every day is internally consistent), or
    #   * an individual day contradicts itself in the source (2015-07-31 prints
    #     4.0 mm at 8pm against a 24-hour total of 0).
    # Both are reported; neither is silently corrected.
    day_level = [c for c in failed if c.get("rowwise_mismatches", 0) > 0]
    source_errors = [c for c in failed if c.get("rowwise_mismatches", 0) == 0]
    flagged_days = sorted(d for c in day_level for d in c.get("inconsistent_days", []))
    all_checks = rain_checks + temp_checks
    blank_pages = [c for c in all_checks if c.get("skipped") == "blank"]
    summary_pages = [c for c in all_checks if c.get("skipped") == "summary"]
    unreadable = [c for c in all_checks if c.get("skipped") == "unparsed"]

    report = {
        "station": STATION,
        "precipitation": {
            "files": len(pcpn), "daily_rows": len(rain_df),
            "duplicate_dates_dropped": dup_rain,
            "date_min": rain_df["date"].min() if len(rain_df) else None,
            "date_max": rain_df["date"].max() if len(rain_df) else None,
            "days_with_reading": int(rain_df["rain_24h_mm"].notna().sum()) if len(rain_df) else 0,
            "pages_failing_checksum": len(failed),
        },
        "temperature": {
            "files": len(temp), "daily_rows": len(temp_df),
            "duplicate_dates_dropped": dup_temp,
            "date_min": temp_df["date"].min() if len(temp_df) else None,
            "date_max": temp_df["date"].max() if len(temp_df) else None,
            "days_with_tmax": int(temp_df["tmax_c"].notna().sum()) if len(temp_df) else 0,
            "days_with_tmin": int(temp_df["tmin_c"].notna().sum()) if len(temp_df) else 0,
        },
        "temperature_quality_flags": _temperature_flags(temp_df),
        "pages_source_sum_errors": len(source_errors),
        "pages_with_inconsistent_days": len(day_level),
        "source_inconsistent_days": flagged_days,
        "pages_blank": len(blank_pages),
        "pages_monthly_summary": len(summary_pages),
        "pages_unreadable": unreadable,
        "checksum_failures": failed[:40],
    }
    (output_dir / "pagasa_extraction_report.json").write_text(
        json.dumps(report, indent=2, default=str), encoding="utf-8"
    )

    logger.warning("Precipitation: %d daily rows %s..%s (%d duplicate dates dropped)",
                   len(rain_df), report["precipitation"]["date_min"],
                   report["precipitation"]["date_max"], dup_rain)
    logger.warning("Temperature:   %d daily rows %s..%s (%d duplicate dates dropped)",
                   len(temp_df), report["temperature"]["date_min"],
                   report["temperature"]["date_max"], dup_temp)
    if source_errors:
        logger.warning(
            "%d page(s) disagree with their own printed SUM row while every daily row is "
            "internally consistent — the SOURCE totals are wrong, not the extraction: %s",
            len(source_errors),
            [f"{c['year']}-{c['month']:02d}" for c in source_errors],
        )
    if flagged_days:
        logger.warning(
            "%d individual day(s) contradict themselves in the source (sub-readings do not add "
            "to that day's own 24-hour total) and are left exactly as printed: %s",
            len(flagged_days), flagged_days,
        )
    logger.warning("Skipped %d blank page(s) and %d monthly-summary page(s) — neither is an error.",
                   len(blank_pages), len(summary_pages))
    if unreadable:
        logger.error("%d page(s) had data-like content that could not be parsed.", len(unreadable))
    tflags = _temperature_flags(temp_df)
    if tflags:
        logger.warning(
            "Temperature quality flags (reported, NOT corrected): %d row(s) with tmin > tmax, "
            "%d row(s) outside a plausible Iloilo envelope.",
            tflags["tmin_exceeds_tmax"]["count"],
            tflags["outside_plausible_envelope"]["count"],
        )
    logger.warning(
        "Extraction faithful: %d of %d precipitation pages reproduce their own printed "
        "24-hour sum exactly.",
        len([c for c in rain_checks if c.get("sum_ok") is True]),
        len([c for c in rain_checks if "sum_ok" in c]),
    )
    return report


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--source-dir", type=Path, default=REPO_ROOT / "data" / "raw" / "pagasa")
    ap.add_argument("--output-dir", type=Path, default=REPO_ROOT / "data" / "external")
    args = ap.parse_args(argv)
    run(args.source_dir, args.output_dir)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
