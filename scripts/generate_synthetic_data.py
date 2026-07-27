"""
MAAGAP Synthetic Data Generation
================================================================================
Addresses a data gap identified in the Data Audit Report's Gap Analysis
(Section 5), pre-authorized by Chapter 1's "Data Availability" limitation:

  Contractor performance records — not present in any supplied sheet.
  Generates a standalone, clearly-labeled SYNTHETIC contractor roster
  (delay history, reliability score) and a placeholder probabilistic
  assignment of contractor_id onto each monitoring record, so the join
  mechanics can be built and tested now, ahead of real procurement/
  contractor records from PPDO.

BUSINESS LOGIC CORRECTION (removed in this version): an earlier version of
this script also fabricated a synthetic Date of Completion for 2023-2026
monitoring rows that were missing one. That was wrong. A missing completion
date on a recent project is not a data-collection gap to be patched — it
means the project is still ONGOING. Fabricating a completion date for an
active project manufactures a ground-truth label (Red Flag / Negative
Slippage) for an outcome that has not happened yet, which is target leakage
in the most literal sense: the "answer" would have been invented, not
observed. These rows are exactly the population MAAGAP exists to score, so
they now flow through feature_engineering.py to data/ready/inference.csv
instead of being assigned a fake label and mixed into train/test.

IMPORTANT: every synthetic value produced here is flagged in its own column
(`contractor_is_synthetic`) so it can be excluded, down-weighted, or audited
separately during model training. This script never fabricates or overwrites
a real, observed value.

Usage:
    python generate_synthetic_data.py \
        --monitoring-input ../data/processed/monitoring_cleaned.csv \
        --output-dir ../data/synthetic \
        --n-contractors 150 \
        --seed 42
================================================================================
"""

from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path
from typing import Optional

import numpy as np
import pandas as pd

logger = logging.getLogger("maagap.synthetic")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)

# Reused from preprocess.py so the two scripts agree on the province's LGU
# list without a hard import dependency between them (kept standalone
# deliberately — see module docstring in preprocess.py, Step 3).
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


def generate_contractor_profiles(n_contractors: int, rng: np.random.Generator) -> pd.DataFrame:
    """
    Generate a standalone, clearly-synthetic contractor roster.

    Every field here is fabricated for pipeline-development purposes and is
    NOT derived from any real PPDO/procurement record — no such record was
    present in the supplied workbook (Data Audit Report, Section 5). Naming
    uses an unambiguous "SYN-CONTRACTOR-####" pattern rather than plausible-
    sounding business names, specifically so it cannot be mistaken for real
    contractor data downstream.
    """
    logger.info("Generating %d synthetic contractor profiles", n_contractors)

    contractor_id = [f"SYN-CONTRACTOR-{i:04d}" for i in range(1, n_contractors + 1)]
    primary_municipality = rng.choice(MUNICIPALITY_REFERENCE, size=n_contractors)
    specialization = rng.choice(
        ["Infrastructure", "Non-Infrastructure", "Both"], size=n_contractors, p=[0.45, 0.35, 0.20]
    )
    years_active = rng.integers(1, 16, size=n_contractors)

    # Delay rate: Beta distribution skewed toward moderate reliability, with a
    # long tail of chronically late contractors — a plausible shape for a
    # public-works contractor pool, not derived from real observations.
    historical_delay_rate = rng.beta(a=2.0, b=5.0, size=n_contractors)
    total_projects_completed = rng.poisson(lam=years_active * 2.5).astype(int) + 1

    # Average delay magnitude scales with delay rate plus noise, floored at 0.
    historical_avg_delay_days = np.clip(
        historical_delay_rate * 240 + rng.normal(0, 20, size=n_contractors), 0, None
    ).round(1)

    reliability_score = np.clip(
        1.0 - historical_delay_rate + rng.normal(0, 0.05, size=n_contractors), 0.0, 1.0
    ).round(3)

    df = pd.DataFrame({
        "contractor_id": contractor_id,
        "contractor_is_synthetic": True,
        "primary_municipality": primary_municipality,
        "specialization": specialization,
        "years_active": years_active,
        "total_projects_completed": total_projects_completed,
        "historical_delay_rate": historical_delay_rate.round(3),
        "historical_avg_delay_days": historical_avg_delay_days,
        "reliability_score": reliability_score,
    })
    logger.info(
        "  mean reliability_score=%.3f, mean historical_delay_rate=%.3f",
        df["reliability_score"].mean(), df["historical_delay_rate"].mean(),
    )
    return df


def assign_contractors_to_projects(
    monitoring: pd.DataFrame, contractors: pd.DataFrame, rng: np.random.Generator
) -> pd.Series:
    """
    Probabilistically assign a contractor_id to each monitoring row, biased
    toward contractors whose `primary_municipality` matches the project's
    location, to approximate the real-world tendency of LGU contracts to go
    to locally-based contractors. This is a PLACEHOLDER join key: no real
    contractor identifier exists anywhere in the source workbook, so this
    assignment is fabricated to exercise the join/feature-engineering
    mechanics now and must be replaced once real contractor-project linkage
    data is obtained from PPDO or PhilGEPS procurement records.
    """
    municipality_proxy = monitoring["LOCATION"].astype(str).map(lambda s: s.split(",")[-1].strip().lower())
    contractors_by_muni: dict[str, list[str]] = {}
    for muni, ids in contractors.groupby(contractors["primary_municipality"].str.lower())["contractor_id"]:
        contractors_by_muni[muni] = ids.tolist()

    all_ids = contractors["contractor_id"].tolist()
    assigned = []
    for muni in municipality_proxy:
        local_pool = contractors_by_muni.get(muni)
        if local_pool and rng.random() < 0.7:  # 70% chance of using a locally-based contractor
            assigned.append(rng.choice(local_pool))
        else:
            assigned.append(rng.choice(all_ids))
    return pd.Series(assigned, index=monitoring.index, name="contractor_id")


# ==============================================================================
# Orchestration
# ==============================================================================

def run(monitoring_input: Path, output_dir: Path, n_contractors: int = 150, seed: int = 42) -> None:
    rng = np.random.default_rng(seed)
    output_dir.mkdir(parents=True, exist_ok=True)

    if not monitoring_input.exists():
        raise FileNotFoundError(
            f"{monitoring_input} not found — run preprocess.py (Steps 1-5) first "
            f"to produce monitoring_cleaned.csv."
        )
    monitoring = pd.read_csv(monitoring_input)
    required = {"LOCATION"}
    missing_cols = required - set(monitoring.columns)
    if missing_cols:
        raise ValueError(
            f"{monitoring_input} is missing expected column(s) {missing_cols}. "
            f"Was this file produced by the current version of preprocess.py?"
        )

    contractors = generate_contractor_profiles(n_contractors, rng)
    monitoring["contractor_id"] = assign_contractors_to_projects(monitoring, contractors, rng)

    contractors_path = output_dir / "contractor_profiles.csv"
    monitoring_path = output_dir / "monitoring_with_contractors.csv"
    contractors.to_csv(contractors_path, index=False)
    monitoring.to_csv(monitoring_path, index=False)
    logger.info("Wrote %s and %s", contractors_path.name, monitoring_path.name)
    logger.info(
        "No completion-date backfilling was performed — rows missing 'Date  of Completion' "
        "are genuinely ongoing/unresolved projects and are routed to data/ready/inference.csv "
        "by feature_engineering.py, not assigned a fabricated label here."
    )


def parse_args(argv: Optional[list[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="MAAGAP synthetic contractor data generation.")
    parser.add_argument("--monitoring-input", type=Path, required=True,
                         help="Path to monitoring_cleaned.csv produced by preprocess.py Steps 1-5.")
    parser.add_argument("--output-dir", type=Path, default=Path("data/synthetic"))
    parser.add_argument("--n-contractors", type=int, default=150)
    parser.add_argument("--seed", type=int, default=42, help="Random seed for reproducibility.")
    return parser.parse_args(argv)


def main(argv: Optional[list[str]] = None) -> int:
    args = parse_args(argv)
    try:
        run(args.monitoring_input, args.output_dir, args.n_contractors, args.seed)
    except (FileNotFoundError, ValueError) as exc:
        logger.error("Aborted: %s", exc)
        return 1
    except Exception:
        logger.exception("Synthetic data generation failed with an unexpected error.")
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
