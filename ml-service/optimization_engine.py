"""
MAAGAP — Prescriptive Resource Allocation / Optimization Engine (Objective 4)
================================================================================
Formulates and solves a constrained integer program (via PuLP) that turns the
Level 1 meta-learner's project risk scores into an actionable weekly PPDO
field-inspector deployment schedule: which inspector visits which project on
which day, prioritizing High/Critical-risk projects while keeping each
inspector's daily/weekly travel geographically coherent.

WHY THIS SCRIPT SCORES data/ready/inference.csv, NOT data/ready/test.csv
--------------------------------------------------------------------------
test.csv holds RESOLVED projects — ones that already have a completion date
and a known RedFlag outcome. There is nothing to "reallocate resources"
toward for a project that has already finished; scheduling an inspector visit
to a closed project is not an actionable recommendation. inference.csv holds
exactly the opposite: the currently ONGOING projects (per the Phase 3
business-logic correction — missing completion date means still in progress,
not missing data), which is precisely the live population PPDO stakeholders
need monitored going forward. This mirrors the earlier stated intent that
inference.csv "is the live data our stakeholders will monitor on the Next.js
dashboard" — the optimization engine is the second consumer of that same
live scoring surface, alongside the dashboard.

Because no script yet existed to run the trained Level 0/Level 1 artifacts
against inference.csv (train_trees.py/train_lstm.py/train_meta_learner.py all
operate on the resolved train/test split only), `score_ongoing_projects()`
below adds that missing scoring step: it reuses the exact same feature-matrix
construction, sequence-scaling, and meta-learner logic already implemented
and tested in those three scripts, applied to the ongoing-project population
instead of the held-out test split.

COVERAGE CAVEAT (same root cause as the meta-learner's small test-set count)
------------------------------------------------------------------------------
Only ongoing projects with BOTH a scoreable tabular feature row AND a
matching LSTM event sequence receive a full three-base-learner meta-learner
score (this was true for the resolved test set too: 33 of 99 test rows had
LSTM coverage). Ongoing projects lacking an LSTM sequence are excluded from
this script's output with a logged count, rather than silently scored with a
different, inconsistent feature set — the schedule this script produces
should be read as "the highest-confidence subset of ongoing projects we can
score end-to-end today," not the full ongoing portfolio.

GEOGRAPHIC ADJACENCY — DOCUMENTED APPROXIMATION, NOT VERIFIED GIS DATA
--------------------------------------------------------------------------
The "neighboring municipality" grouping used for the travel-friction
constraint (`MUNICIPALITY_CLUSTERS` below) is built from Iloilo province's
commonly recognized sub-regional geography (northern coastal towns, central
towns around Iloilo City, western/upland towns, eastern lowland towns, and
the interior Passi corridor). It is NOT sourced from an authoritative
PSGC/GIS boundary-adjacency dataset or a real road-network distance matrix.
It is a reasonable, defensible first-pass proxy for demonstrating the LP
formulation and should be replaced with verified centroid-distance or
shared-boundary adjacency data (e.g., derived from PSGC shapefiles or a real
routing API) before this schedule is used operationally. Treat
`MUNICIPALITY_CLUSTERS` the same way `PRICES_DATASET_ID` was treated in
fetch_psa_data.py: a clearly-flagged placeholder for a domain expert to
refine, not a validated ground truth.

LP FORMULATION SUMMARY
-------------------------
Sets:
    I = inspectors (size configurable, PPDO baseline 5-6)
    D = workdays in the planning week (Mon-Fri)
    P = ongoing projects scored High or Critical risk by the meta-learner
    C = geographic clusters (municipality groupings)

Decision variables (all binary):
    x[i,p,d]  = 1 if inspector i visits project p on day d
    y[i,d,c]  = 1 if inspector i is assigned to cluster c on day d
    z[i,c]    = 1 if inspector i visits cluster c at all during the week

Objective:  maximize  sum(risk_weight[p] * x[i,p,d])  -  TRAVEL_PENALTY * sum(z[i,c])
    Risk-weighted coverage rewards visiting higher-risk projects; the
    z[i,c] penalty discourages an inspector's week from sprawling across
    many different geographic clusters (each additional cluster an
    inspector touches in a week represents real additional travel time
    that a pure coverage-maximizing objective would otherwise ignore).

Constraints:
    - Each project visited at most once across the whole week.
    - Each inspector visits at most DAILY_CAPACITY projects per day.
    - Each inspector visits at most WEEKLY_CAPACITY projects per week.
    - An inspector may be assigned to at most one cluster per day
      (y[i,d,c] summed over c <= 1) — this is the mechanism that actually
      enforces "ease of travel": it structurally forbids assigning an
      inspector to two far-apart clusters on the same day.
    - x[i,p,d] <= y[i,d,cluster(p)] — an inspector can only visit a
      project on a day they are assigned to that project's cluster.
    - z[i,c] >= y[i,d,c] for every day d — a cluster counts toward the
      travel-friction penalty as soon as the inspector visits it on any
      day that week.

Usage
-----
    python optimization_engine.py --output ml-service/artifacts/inspector_schedule.csv

Requires: pandas, numpy, joblib, pulp, tensorflow (for LSTM inference scoring)
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
from pathlib import Path
from typing import Optional

os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "3")

import joblib
import numpy as np
import pandas as pd
import pulp

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("optimization_engine")

THIS_DIR = Path(__file__).resolve().parent
ML_SERVICE_DIR = THIS_DIR
REPO_ROOT = THIS_DIR.parent
DATA_READY_DIR = REPO_ROOT / "data" / "ready"
ARTIFACTS_DIR = THIS_DIR / "artifacts"

sys.path.insert(0, str(ML_SERVICE_DIR))
sys.path.insert(0, str(ML_SERVICE_DIR / "models"))

from data_pipeline.preprocess import canonicalize_municipality  # noqa: E402
from train_trees import build_feature_matrix  # noqa: E402
from train_lstm import PAD_VALUE, apply_sequence_scaler  # noqa: E402

# ---------------------------------------------------------------------------
# Risk tier thresholds — must match Chapter 3 / train_meta_learner.py exactly.
# ---------------------------------------------------------------------------

def probability_to_risk_tier(prob: float) -> str:
    if prob < 0.3:
        return "Low"
    if prob < 0.7:
        return "Medium"
    if prob < 0.9:
        return "High"
    return "Critical"


RISK_WEIGHTS = {"High": 1.0, "Critical": 2.5}  # Critical weighted higher: objective prioritizes it.
TARGET_TIERS = set(RISK_WEIGHTS.keys())

# ---------------------------------------------------------------------------
# Geographic clustering — SEE MODULE DOCSTRING CAVEAT ABOVE.
# **MUNICIPALITY_CLUSTERS** — placeholder-quality approximation; refine with
# verified GIS/road-network adjacency before operational use.
# ---------------------------------------------------------------------------

MUNICIPALITY_CLUSTERS: dict[str, str] = {
    # Northern coastal cluster
    "Concepcion": "North Coastal", "Estancia": "North Coastal", "Balasan": "North Coastal",
    "Batad": "North Coastal", "Carles": "North Coastal", "San Dionisio": "North Coastal",
    "Ajuy": "North Coastal", "Sara": "North Coastal",
    # Lemery borders Balasan/San Dionisio/Batad (all North Coastal) on three
    # sides -- placeholder-quality approximation, same caveat as the rest of
    # this dict (see module docstring), added here rather than left
    # "Unmapped" purely because MUNICIPALITY_REFERENCE (preprocess.py) had
    # it and this dict didn't.
    "Lemery": "North Coastal",
    # Central / Metro Iloilo cluster
    "Iloilo City": "Central Metro", "Pavia": "Central Metro", "Leganes": "Central Metro",
    "Zarraga": "Central Metro", "Santa Barbara": "Central Metro", "San Miguel": "Central Metro",
    "Cabatuan": "Central Metro", "New Lucena": "Central Metro",
    # Western / upland (Antique-border) cluster
    "Igbaras": "Western Upland", "Guimbal": "Western Upland", "Tigbauan": "Western Upland",
    "San Joaquin": "Western Upland", "Miagao": "Western Upland", "Tubungan": "Western Upland",
    "Alimodian": "Western Upland", "Leon": "Western Upland", "Oton": "Western Upland",
    # Same placeholder-quality caveat as Lemery above -- Maasin borders
    # Alimodian/Leon (Western Upland) and Cabatuan/San Miguel (Central
    # Metro); grouped here since it's conventionally treated as part of
    # Iloilo's upland interior.
    "Maasin": "Western Upland",
    # Eastern lowland cluster
    "Banate": "Eastern Lowland", "Barotac Nuevo": "Eastern Lowland", "Dingle": "Eastern Lowland",
    "Anilao": "Eastern Lowland", "Dueñas": "Eastern Lowland", "San Enrique": "Eastern Lowland",
    "Dumangas": "Eastern Lowland", "Barotac Viejo": "Eastern Lowland",
    # Interior / Passi corridor cluster
    "Passi City": "Interior Passi Corridor", "Calinog": "Interior Passi Corridor",
    "Lambunao": "Interior Passi Corridor", "Bingawan": "Interior Passi Corridor",
    "Badiangan": "Interior Passi Corridor", "Mina": "Interior Passi Corridor",
    "Pototan": "Interior Passi Corridor", "San Rafael": "Interior Passi Corridor",
    "Janiuay": "Interior Passi Corridor",
}
UNKNOWN_CLUSTER = "Unclustered"

# ---------------------------------------------------------------------------
# Logistical baseline — PPDO staffing / capacity assumptions.
# ---------------------------------------------------------------------------

INSPECTOR_COUNT = 6            # PPDO baseline: 5-6 permanent field inspectors.
INSPECTOR_IDS = [f"Inspector_{i+1}" for i in range(INSPECTOR_COUNT)]
WORKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"]
DAILY_CAPACITY = 3             # Max site visits per inspector per day (travel-time realistic).
WEEKLY_CAPACITY = 12           # Max site visits per inspector per week.
TRAVEL_PENALTY = 0.75          # Objective-function cost per distinct cluster an inspector visits in the week.
MAX_PROJECTS_CONSIDERED = 150  # Cap the candidate pool for solver tractability (highest-risk-first).


# ---------------------------------------------------------------------------
# Step 1 — score the ongoing-project population end-to-end (RF, XGBoost,
# LSTM, meta-learner), reusing the exact logic already validated in
# train_trees.py / train_lstm.py / train_meta_learner.py.
# ---------------------------------------------------------------------------


def resolve_municipality(location_raw: str) -> str:
    """
    Best-effort municipality resolution from a raw LOCATION string (e.g.
    "Brgy. Sto. Tomas, Janiuay"). Tries the last comma-separated token first
    (typically the municipality in this dataset's LOCATION convention), falls
    back to canonicalizing the full string, and returns "Unmapped" if neither
    resolves to one of the 44 reference Iloilo LGUs — logged, not silently
    dropped, so coverage gaps are visible.
    """
    if not isinstance(location_raw, str) or not location_raw.strip():
        return "Unmapped"
    parts = [p.strip() for p in location_raw.split(",") if p.strip()]
    candidates = ([parts[-1]] if parts else []) + [location_raw]
    for candidate in candidates:
        canon = canonicalize_municipality(candidate)
        if canon in MUNICIPALITY_CLUSTERS:
            return canon
    return "Unmapped"


def score_tabular(inference_df: pd.DataFrame) -> pd.DataFrame:
    """Apply the saved Random Forest and XGBoost models to the ongoing-project
    feature matrix, reusing build_feature_matrix()'s exact column handling
    from train_trees.py so the feature schema matches training exactly.

    Also computes each project's top SHAP-contributing features (see
    inference/explain.py) in the same pass, batched across every row at
    once -- this is the actual canonical scoring path for the ~4,000+
    already-seeded ongoing projects (via scripts/seed_supabase.py), so this
    is where a Manager's "why this classification?" data for most projects
    on the dashboard actually comes from."""
    kept_columns = json.load(open(ARTIFACTS_DIR / "tabular_feature_columns.json"))
    X_inf, _ = build_feature_matrix(inference_df, keep_columns=kept_columns)

    rf = joblib.load(ARTIFACTS_DIR / "random_forest.joblib")
    xgb = joblib.load(ARTIFACTS_DIR / "xgboost.joblib")

    from inference.explain import explain_batch

    try:
        shap_top_features = explain_batch(rf, xgb, X_inf, kept_columns)
    except Exception:
        logger.exception(
            "SHAP explanation batch failed -- continuing with risk_tier/risk_probability "
            "scored normally, but shap_top_features will be left NULL for this batch."
        )
        shap_top_features = [None] * len(X_inf)

    return pd.DataFrame({
        "project_key": inference_df["project_key"].values,
        "random_forest_prob": rf.predict_proba(X_inf)[:, 1],
        "xgboost_prob": xgb.predict_proba(X_inf)[:, 1],
        "shap_top_features": shap_top_features,
    })


def score_lstm() -> pd.DataFrame:
    """Apply the saved LSTM model to the ongoing-project sequence tensors
    (lstm_inference_sequences.npy), using the TRAIN-fitted sequence scaler
    (transform only, never re-fit) exactly as train_lstm.py does for its
    test split."""
    import tensorflow as tf  # noqa: F401  (import guarded here, same pattern as train_lstm.py)
    from tensorflow import keras

    sequences = np.load(DATA_READY_DIR / "lstm_inference_sequences.npy")
    mask = np.load(DATA_READY_DIR / "lstm_inference_sequence_mask.npy")
    project_keys = json.load(open(DATA_READY_DIR / "lstm_inference_project_keys.json"))
    scaler_params = json.load(open(ARTIFACTS_DIR / "lstm_sequence_scaler.json"))

    scaled = apply_sequence_scaler(sequences, mask, scaler_params)
    model = keras.models.load_model(ARTIFACTS_DIR / "lstm_model.keras")
    probs = model.predict(scaled, verbose=0).ravel()

    return pd.DataFrame({"project_key": project_keys, "lstm_prob": probs})


def score_ongoing_projects() -> pd.DataFrame:
    """
    Full Level 0 -> Level 1 scoring pipeline for the ongoing-project
    population, returning one row per fully-scoreable project:
    project_key, municipality, cluster, meta_prob, risk_tier.
    """
    inference_df = pd.read_csv(DATA_READY_DIR / "inference.csv", low_memory=False)
    logger.info("Scoring %d ongoing projects from data/ready/inference.csv", len(inference_df))

    tabular_scores = score_tabular(inference_df)
    lstm_scores = score_lstm()

    merged = tabular_scores.merge(lstm_scores, on="project_key", how="inner")
    dropped = len(tabular_scores) - len(merged)
    logger.warning(
        "%d of %d ongoing projects had no matching LSTM sequence and were excluded "
        "from meta-learner scoring (see module docstring's coverage caveat).",
        dropped, len(tabular_scores),
    )

    meta_learner = joblib.load(ARTIFACTS_DIR / "meta_learner.joblib")
    X_meta = merged[["random_forest_prob", "xgboost_prob", "lstm_prob"]].values
    merged["meta_prob"] = meta_learner.predict_proba(X_meta)[:, 1]
    merged["risk_tier"] = merged["meta_prob"].apply(probability_to_risk_tier)

    location_lookup = inference_df.set_index("project_key")["LOCATION"]
    name_lookup = inference_df.set_index("project_key")["NAME OF PROJECT"]
    merged["location_raw"] = merged["project_key"].map(location_lookup)
    merged["project_name"] = merged["project_key"].map(name_lookup)
    merged["municipality"] = merged["location_raw"].apply(resolve_municipality)
    merged["cluster"] = merged["municipality"].map(MUNICIPALITY_CLUSTERS).fillna(UNKNOWN_CLUSTER)

    logger.info("Risk tier distribution across scored ongoing projects:\n%s", merged["risk_tier"].value_counts())
    return merged


# ---------------------------------------------------------------------------
# Step 2 — select the High/Critical-risk candidate pool for scheduling.
# ---------------------------------------------------------------------------


MIN_PRIORITY_PROJECTS_FOR_SCHEDULING = 10
FALLBACK_POOL_SIZE = 60  # size of the relative-risk fallback pool when tier thresholds yield too few/no projects


def select_priority_projects(scored_df: pd.DataFrame, max_projects: int = MAX_PROJECTS_CONSIDERED) -> pd.DataFrame:
    """
    Selects the scheduling candidate pool from the scored ongoing-project
    population.

    FALLBACK BEHAVIOR (documented, not silent): the meta-learner's current
    baseline — trained on only 3 positive OOF examples, per
    docs/MODEL_IMPROVEMENT_STRATEGY.md Section 1 — produces probabilities
    that cluster narrowly in the Medium band and may cross the High (>=0.7)
    or Critical (>=0.9) thresholds for very few or zero projects at any
    given point in time. A resource-allocation engine that simply refuses
    to run whenever that happens is not useful to PPDO today, so when fewer
    than MIN_PRIORITY_PROJECTS_FOR_SCHEDULING projects clear the tier
    thresholds, this function falls back to the top FALLBACK_POOL_SIZE
    ongoing projects by *relative* meta_prob rank (i.e., "riskiest among
    what we have," not "objectively High/Critical per Chapter 3's absolute
    thresholds"). Fallback rows are explicitly tagged in the `risk_tier`
    column as "Relative-Risk (fallback)" rather than mislabeled as a real
    High/Critical tier, and the fallback is logged loudly. This is a stopgap
    for the current small-sample baseline, not a substitute for the
    threshold recalibration recommended in the remediation report.
    """
    priority = scored_df[scored_df["risk_tier"].isin(TARGET_TIERS)].copy()
    priority = priority[priority["cluster"] != UNKNOWN_CLUSTER]  # cannot geographically schedule an unmapped site

    if len(priority) < MIN_PRIORITY_PROJECTS_FOR_SCHEDULING:
        logger.warning(
            "Only %d project(s) cleared the absolute High/Critical thresholds (>= 0.7 meta_prob) — "
            "falling back to the top %d ongoing, cluster-resolved projects by RELATIVE meta_prob rank "
            "so the scheduler has a usable candidate pool. This is a direct, expected symptom of the "
            "current small-sample meta-learner baseline (see docs/MODEL_IMPROVEMENT_STRATEGY.md); "
            "fallback rows are tagged 'Relative-Risk (fallback)', not a real Chapter 3 tier.",
            len(priority), FALLBACK_POOL_SIZE,
        )
        fallback = scored_df[scored_df["cluster"] != UNKNOWN_CLUSTER].copy()
        fallback = fallback.sort_values("meta_prob", ascending=False).head(FALLBACK_POOL_SIZE)
        fallback["risk_tier"] = "Relative-Risk (fallback)"
        priority = fallback
        priority["risk_weight"] = 1.0
    else:
        priority["risk_weight"] = priority["risk_tier"].map(RISK_WEIGHTS)

    priority = priority.sort_values("meta_prob", ascending=False)

    if len(priority) > max_projects:
        logger.warning(
            "%d High/Critical-risk, cluster-resolved projects found; capping to the top %d "
            "by meta_prob for solver tractability.",
            len(priority), max_projects,
        )
        priority = priority.head(max_projects)

    logger.info("Scheduling candidate pool: %d projects across %d clusters.", len(priority), priority["cluster"].nunique())
    return priority.reset_index(drop=True)


# ---------------------------------------------------------------------------
# Step 3 — build and solve the PuLP MILP.
# ---------------------------------------------------------------------------


SOLVER_TIME_LIMIT_SECONDS = 25   # CBC wall-clock cap; the z[i,c] linking constraints create a
                                  # combinatorially large branch-and-bound tree once inspectors are
                                  # symmetric (interchangeable), so an unbounded solve can run
                                  # arbitrarily long chasing a marginal integrality gap. A time-boxed
                                  # solve with a small accepted MIP gap returns a documented
                                  # near-optimal (not necessarily provably optimal) schedule instead.
SOLVER_MIP_GAP = 0.02             # accept a solution within 2% of the proven bound


def build_and_solve_schedule(
    priority_df: pd.DataFrame,
    inspectors: list[str] = INSPECTOR_IDS,
    days: list[str] = WORKDAYS,
    daily_capacity: int = DAILY_CAPACITY,
    weekly_capacity: int = WEEKLY_CAPACITY,
    travel_penalty: float = TRAVEL_PENALTY,
) -> tuple[pd.DataFrame, dict]:
    projects = priority_df["project_key"].tolist()
    risk_weight = dict(zip(priority_df["project_key"], priority_df["risk_weight"]))
    cluster_of = dict(zip(priority_df["project_key"], priority_df["cluster"]))
    clusters = sorted(set(cluster_of.values()))

    if not projects:
        raise ValueError("No High/Critical-risk, cluster-resolved projects available to schedule.")

    prob = pulp.LpProblem("MAAGAP_Inspector_Deployment", pulp.LpMaximize)

    x = pulp.LpVariable.dicts("visit", (inspectors, projects, days), cat="Binary")
    y = pulp.LpVariable.dicts("cluster_day", (inspectors, days, clusters), cat="Binary")
    z = pulp.LpVariable.dicts("cluster_week", (inspectors, clusters), cat="Binary")

    # Objective: maximize risk-weighted coverage, minus a penalty for each
    # distinct cluster an inspector's week touches (travel-friction proxy).
    prob += (
        pulp.lpSum(risk_weight[p] * x[i][p][d] for i in inspectors for p in projects for d in days)
        - travel_penalty * pulp.lpSum(z[i][c] for i in inspectors for c in clusters)
    )

    # Each project visited at most once across the whole week.
    for p in projects:
        prob += pulp.lpSum(x[i][p][d] for i in inspectors for d in days) <= 1, f"once_{p}"

    # Daily / weekly inspector capacity.
    for i in inspectors:
        for d in days:
            prob += pulp.lpSum(x[i][p][d] for p in projects) <= daily_capacity, f"daily_cap_{i}_{d}"
        prob += pulp.lpSum(x[i][p][d] for p in projects for d in days) <= weekly_capacity, f"weekly_cap_{i}"

    # An inspector is assigned to at most one cluster per day (enforces
    # geographic coherence: no cross-cluster hopping within a single day).
    for i in inspectors:
        for d in days:
            prob += pulp.lpSum(y[i][d][c] for c in clusters) <= 1, f"one_cluster_per_day_{i}_{d}"

    # A project can only be visited on a day the inspector is assigned to
    # that project's cluster.
    for i in inspectors:
        for p in projects:
            c = cluster_of[p]
            for d in days:
                prob += x[i][p][d] <= y[i][d][c], f"link_visit_cluster_{i}_{p}_{d}"

    # z[i,c] activates as soon as inspector i is assigned to cluster c on
    # any day of the week (feeds the travel-friction penalty term).
    for i in inspectors:
        for c in clusters:
            for d in days:
                prob += z[i][c] >= y[i][d][c], f"activate_cluster_week_{i}_{c}_{d}"

    solver = pulp.PULP_CBC_CMD(msg=False, timeLimit=SOLVER_TIME_LIMIT_SECONDS, gapRel=SOLVER_MIP_GAP)
    prob.solve(solver)

    status = pulp.LpStatus[prob.status]
    logger.info("Solver status: %s | Objective value: %.4f", status, pulp.value(prob.objective) or 0.0)

    schedule_rows = []
    for i in inspectors:
        for d in days:
            for p in projects:
                if pulp.value(x[i][p][d]) and pulp.value(x[i][p][d]) > 0.5:
                    row = priority_df[priority_df["project_key"] == p].iloc[0]
                    schedule_rows.append({
                        "inspector": i,
                        "day": d,
                        "project_key": p,
                        "project_name": row["project_name"],
                        "municipality": row["municipality"],
                        "cluster": row["cluster"],
                        "risk_tier": row["risk_tier"],
                        "meta_prob": round(float(row["meta_prob"]), 4),
                    })

    schedule_df = pd.DataFrame(schedule_rows)
    day_order = {d: i for i, d in enumerate(days)}
    if not schedule_df.empty:
        schedule_df = schedule_df.sort_values(
            by=["inspector", "day"], key=lambda col: col.map(day_order) if col.name == "day" else col
        ).reset_index(drop=True)

    n_covered = schedule_df["project_key"].nunique() if not schedule_df.empty else 0
    n_critical_covered = int((schedule_df["risk_tier"] == "Critical").sum()) if not schedule_df.empty else 0
    summary = {
        "solver_status": status,
        "objective_value": pulp.value(prob.objective),
        "candidate_projects": len(projects),
        "projects_scheduled": n_covered,
        "coverage_rate": round(n_covered / len(projects), 4) if projects else 0.0,
        "critical_projects_scheduled": n_critical_covered,
        "inspectors_used": inspectors,
        "clusters_touched": schedule_df["cluster"].nunique() if not schedule_df.empty else 0,
    }
    return schedule_df, summary


# ---------------------------------------------------------------------------
# Orchestration
# ---------------------------------------------------------------------------


def run(output_path: str) -> None:
    scored_df = score_ongoing_projects()
    priority_df = select_priority_projects(scored_df)
    schedule_df, summary = build_and_solve_schedule(priority_df)

    out_path = Path(output_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    schedule_df.to_csv(out_path, index=False)
    logger.info("Wrote inspector deployment schedule (%d assignments) to %s", len(schedule_df), out_path)

    summary_path = out_path.with_name(out_path.stem + "_summary.json")
    with open(summary_path, "w") as f:
        json.dump(summary, f, indent=2, default=str)
    logger.info("Summary: %s", json.dumps(summary, indent=2, default=str))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--output",
        default=str(ARTIFACTS_DIR / "inspector_schedule.csv"),
        help="Output CSV path for the weekly inspector deployment schedule.",
    )
    args = parser.parse_args()
    run(args.output)


if __name__ == "__main__":
    main()
