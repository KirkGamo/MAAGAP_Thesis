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
import time
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
from common.paths import SCHEDULE_CSV_PATH  # noqa: E402

sys.path.insert(0, str(ML_SERVICE_DIR))
sys.path.insert(0, str(ML_SERVICE_DIR / "models"))

from data_pipeline.preprocess import canonicalize_municipality  # noqa: E402
from train_trees import build_feature_matrix  # noqa: E402
from common.visit_history import last_visit_dates, recently_visited_keys  # noqa: E402
from common.aging import DEFAULT_WINDOW_WEEKS, apply_aging  # noqa: E402
from train_lstm import apply_sequence_scaler  # noqa: E402

# ---------------------------------------------------------------------------
# Risk tier thresholds — imported from the single shared definition rather than
# restated here, so this module and train_meta_learner.py cannot drift apart.
# ---------------------------------------------------------------------------

from common.risk_tiers import probability_to_risk_tier  # noqa: E402
from common.geography import cluster_mobilization_costs  # noqa: E402


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
# BUDGET AND EQUIPMENT — Chapter 3's remaining two constraint classes.
#
# Chapter 3 formulates the allocation problem "under constraints such as
# budget, manpower, and equipment" and prints a budget ceiling explicitly.
# Only manpower (the capacity limits above) and geography were implemented;
# the constants below add the other two.
#
# PLACEHOLDER COST FIGURES — CONFIRM WITH PPDO BEFORE OPERATIONAL USE.
# These are order-of-magnitude estimates for a provincial field visit, not
# figures taken from PPDO's travel/per-diem schedule. Treat them exactly as
# MUNICIPALITY_CLUSTERS above is treated: a clearly-flagged placeholder for a
# domain expert to replace, never validated ground truth. Every peso figure
# the optimizer reports inherits their uncertainty.
# ---------------------------------------------------------------------------

VISIT_COST_PHP = 850.0                 # Per-diem + fuel attributable to one site visit.
CLUSTER_MOBILIZATION_COST_PHP = 1200.0 # Cost of an inspector working a cluster at all in a week.
WEEKLY_FIELD_BUDGET_PHP = 60000.0      # Ceiling on total weekly deployment cost.

# Equipment: service vehicles available on any single day. Fewer than the
# inspector count, which is the point — the Delimitation names vehicle
# availability as a real logistical hurdle bounding inspection frequency.
# Inspectors deployed on the same day each need a vehicle, so this caps how
# many can be in the field simultaneously regardless of available manpower.
VEHICLE_COUNT = 4

# Penalty per inspector-day opened. WITHOUT THIS TERM THE SOLVER IS
# INDIFFERENT TO HOW MANY INSPECTOR-DAYS IT CONSUMES: once coverage is
# saturated, nothing in the objective distinguishes covering 25 projects in 9
# inspector-days from covering the same 25 in 12. Measured against the
# allocation-efficiency metric, that indifference made the optimizer 25% WORSE
# than a naive greedy allocator, which packs each day to capacity before
# opening the next simply as a side effect of first-fit placement.
#
# Kept strictly below the weight of the least valuable visit (High = 1.0) so
# that saving an inspector-day can never be worth DROPPING a visit — the
# solver should pack the work it does, never do less of it.
INSPECTOR_DAY_PENALTY = 0.5

# Lambda in Chapter 3's objective: the cost-priority tradeoff parameter
# weighting total deployment cost against risk-weighted coverage. Kept small
# by default so risk coverage dominates and the budget binds primarily as a
# hard constraint (which is how Chapter 3 lists it); raise it to make the
# solver trade coverage away for cost directly.
COST_WEIGHT = 0.0001


def resolve_cluster_costs(
    clusters: list[str], flat_fallback_php: float = CLUSTER_MOBILIZATION_COST_PHP
) -> dict[str, float]:
    """
    Per-cluster weekly mobilization cost, priced by the real round-trip distance
    from the PPDO base to each cluster's centroid (PPDO's 2026-09 LMB barangay
    point layer).

    This replaces a single flat charge applied to every cluster equally. Measured
    against the current grouping, that flat figure was wrong by a factor of 6.3:
    Central Metro's centroid is 14.3 km from base and North Coastal's is 90.1 km,
    and both were charged PHP 1,200. Distance-priced, they are PHP 428 and
    PHP 2,704.

    Clusters with no locatable municipality (e.g. UNKNOWN_CLUSTER) keep the flat
    fallback rather than being priced at zero, which would make them look free
    and attract every visit.
    """
    members: dict[str, list[str]] = {}
    for municipality, cluster in MUNICIPALITY_CLUSTERS.items():
        members.setdefault(cluster, []).append(municipality)

    costs = cluster_mobilization_costs(
        {c: members.get(c, []) for c in clusters}, flat_fallback_php=flat_fallback_php
    )
    return {c: costs.get(c, flat_fallback_php) for c in clusters}


def allocation_efficiency(schedule_df: pd.DataFrame) -> Optional[float]:
    """
    ALLOCATION EFFICIENCY — Objective 4's success metric, defined here once so
    that every measurement of it uses the same formula.

        efficiency = (total risk weight of projects visited)
                     / (inspector-days consumed to visit them)

    Read as "how much monitoring risk is retired per inspector-day spent". It
    is the natural quantity for this problem because the scarce resource is
    inspector time, not project count, and because visiting one Critical
    project is genuinely worth more than visiting one High project — which a
    raw coverage-rate metric cannot express.

    Defined BEFORE any comparison was run, so the 15% improvement target in
    Objective 4 is measured against a fixed yardstick rather than one chosen
    after seeing which yardstick flattered the result.
    """
    if schedule_df is None or schedule_df.empty:
        return None

    mapped = schedule_df["risk_tier"].map(RISK_WEIGHTS)
    # UNDEFINED, NOT ZERO. When select_priority_projects() falls back to the
    # relative-risk pool it tags every row "Relative-Risk (fallback)", which is
    # not in RISK_WEIGHTS. Mapping then yields NaN for every row, and the old
    # .fillna(0.0) turned that into an efficiency of exactly 0.0 -- reported as
    # a number, indistinguishable from a genuinely worthless schedule, on
    # Objective 4's headline metric. A metric that cannot be computed must say
    # so rather than return the most alarming value in its range.
    if mapped.isna().all():
        logger.warning(
            "Allocation efficiency is undefined for this schedule: none of its "
            "risk tiers (%s) carry a risk weight. This is the relative-risk "
            "fallback pool, whose rows are deliberately not real Chapter 3 "
            "tiers, so 'risk retired per inspector-day' has no meaning here.",
            sorted(schedule_df["risk_tier"].unique()),
        )
        return None

    if mapped.isna().any():
        logger.warning(
            "%d of %d scheduled row(s) carry a risk tier with no weight (%s); "
            "they contribute nothing to allocation efficiency.",
            int(mapped.isna().sum()), len(mapped),
            sorted(set(schedule_df.loc[mapped.isna(), "risk_tier"])),
        )

    risk_weight_total = float(mapped.fillna(0.0).sum())
    inspector_days = int(schedule_df.groupby(["inspector", "day"]).ngroups)
    if inspector_days == 0:
        return None
    return round(risk_weight_total / inspector_days, 4)


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

    # E1: SHAP is NOT computed here any more. It used to run for every row in
    # this function, before any risk tier was known -- 4,786 explainer calls on
    # the last full run, the large majority of the job's wall time. The
    # explanations are then read only when a manager opens one project's detail
    # page, and the pages worth opening are the High and Critical ones.
    #
    # explain_scored_projects() below computes them AFTER tiers are assigned,
    # for the actionable subset only. The feature matrix is returned alongside
    # the probabilities so that second pass does not have to rebuild it.
    scored = pd.DataFrame({
        "project_key": inference_df["project_key"].values,
        "random_forest_prob": rf.predict_proba(X_inf)[:, 1],
        "xgboost_prob": xgb.predict_proba(X_inf)[:, 1],
    })
    # Key the matrix by project_key so the later explanation pass aligns by
    # identity rather than by position, which the LEFT join and tier filtering
    # would otherwise invalidate.
    X_keyed = X_inf.copy()
    X_keyed.index = pd.Index(inference_df["project_key"].values, name="project_key")
    scored.attrs["X_inf"] = X_keyed
    scored.attrs["kept_columns"] = kept_columns
    return scored


# Tiers whose detail pages a manager plausibly opens, and therefore the only
# ones whose explanations are precomputed. Anything else is explained on demand
# by inference/explain.py's single-row path.
EXPLAINED_TIERS = ("High", "Critical")


def explain_scored_projects(
    merged: pd.DataFrame,
    X_inf: pd.DataFrame,
    kept_columns: list[str],
    tiers: tuple[str, ...] = EXPLAINED_TIERS,
) -> list:
    """
    Per-project SHAP explanations for the actionable tiers only.

    Objective 4's interpretability commitment is that a manager can ask "why
    this classification?" of a project in front of them. That is satisfied by
    explaining the projects they can act on, plus the single-row path for
    anything else opened on demand -- not by explaining all 2,393 rows on every
    batch run, most of which are Low tier and will never be opened.

    Returns a list aligned to `merged`, with None where no explanation was
    computed. Failure is non-fatal, exactly as before: a project keeps its risk
    tier and probability and simply has no stored explanation.
    """
    out: list = [None] * len(merged)
    if "risk_tier" not in merged.columns:
        return out

    wanted = merged["risk_tier"].isin(tiers).to_numpy()
    n_wanted = int(wanted.sum())
    if n_wanted == 0:
        logger.info("No %s-tier projects to explain.", "/".join(tiers))
        return out

    # X_inf is aligned to the pre-merge scoring frame; select by project_key so
    # the mapping survives the left join and the row filtering above it.
    if X_inf.index.name != "project_key":
        logger.warning(
            "Feature matrix is not keyed by project_key — skipping SHAP for this batch. "
            "Risk tiers are unaffected."
        )
        return out

    key_to_pos = {k: i for i, k in enumerate(X_inf.index)}
    slots, idx = [], []
    for slot, (key, want) in enumerate(zip(merged["project_key"], wanted)):
        if want and key in key_to_pos:
            slots.append(slot)
            idx.append(key_to_pos[key])

    from inference.explain import explain_batch

    try:
        subset = X_inf.iloc[idx]
        explanations = explain_batch(
            joblib.load(ARTIFACTS_DIR / "random_forest.joblib"),
            joblib.load(ARTIFACTS_DIR / "xgboost.joblib"),
            subset,
            kept_columns,
        )
    except Exception:
        logger.exception(
            "SHAP explanation batch failed -- projects keep their risk_tier and "
            "risk_probability, but shap_top_features will be NULL for this batch."
        )
        return out

    logger.warning(
        "SHAP computed for %d of %d scored projects (%s tiers only) — previously all %d "
        "were explained on every run.",
        n_wanted, len(merged), "/".join(tiers), len(merged),
    )
    for slot, expl in zip(slots, explanations):
        out[slot] = expl
    return out


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

    # D21: LEFT join, not inner. Projects without an LSTM sequence are scored
    # by the two-learner fallback instead of being dropped.
    #
    # Sequences are built by iterating the fund-transfer crosswalk, so a
    # monitoring row the crosswalk could not link is keyed MON_ONLY_<id> and
    # never gets one -- previously 1,725 of 2,393 ongoing projects, leaving
    # only 668 scoreable and pinning the scheduling problem in the
    # capacity-slack regime where D17 found every allocator ties.
    #
    # Those rows are not poor quality: they match the scoreable ones on every
    # tabular feature (100% AMOUNT, 99.6% D_start, 99.5% weather, 99.8%
    # resolvable municipality). They lack a sequence because of how project
    # identity is assembled, not because of anything about the projects.
    merged = tabular_scores.merge(lstm_scores, on="project_key", how="left")
    has_lstm = merged["lstm_prob"].notna()

    meta_learner = joblib.load(ARTIFACTS_DIR / "meta_learner.joblib")
    merged["meta_prob"] = np.nan
    merged["score_basis"] = "two_learner"
    merged.loc[has_lstm, "score_basis"] = "three_learner"

    if has_lstm.any():
        X3 = merged.loc[has_lstm, ["random_forest_prob", "xgboost_prob", "lstm_prob"]].values
        merged.loc[has_lstm, "meta_prob"] = meta_learner.predict_proba(X3)[:, 1]

    two_path = ARTIFACTS_DIR / "meta_learner_two.joblib"
    if (~has_lstm).any():
        if two_path.exists():
            two_learner = joblib.load(two_path)
            X2 = merged.loc[~has_lstm, ["random_forest_prob", "xgboost_prob"]].values
            merged.loc[~has_lstm, "meta_prob"] = two_learner.predict_proba(X2)[:, 1]
        else:
            logger.warning(
                "%d projects lack an LSTM sequence and meta_learner_two.joblib is absent — "
                "they stay unscored. Run train_meta_learner.py to build the fallback.",
                int((~has_lstm).sum()),
            )

    merged = merged[merged["meta_prob"].notna()].copy()
    logger.warning(
        "Scored %d ongoing projects: %d with the three-learner model, %d via the "
        "two-learner fallback (no LSTM sequence). Fallback scores are tagged "
        "score_basis='two_learner' so the provenance is explicit rather than hidden.",
        len(merged),
        int((merged["score_basis"] == "three_learner").sum()),
        int((merged["score_basis"] == "two_learner").sum()),
    )

    merged["risk_tier"] = merged["meta_prob"].apply(probability_to_risk_tier)

    # E1: explain only what a manager can act on, now that tiers are known.
    merged["shap_top_features"] = explain_scored_projects(
        merged,
        tabular_scores.attrs.get("X_inf", pd.DataFrame()),
        tabular_scores.attrs.get("kept_columns", []),
    )

    location_lookup = inference_df.set_index("project_key")["LOCATION"]
    name_lookup = inference_df.set_index("project_key")["NAME OF PROJECT"]
    status_lookup = inference_df.set_index("project_key")["STATUS"]
    merged["location_raw"] = merged["project_key"].map(location_lookup)
    merged["project_name"] = merged["project_key"].map(name_lookup)
    merged["municipality"] = merged["location_raw"].apply(resolve_municipality)
    merged["cluster"] = merged["municipality"].map(MUNICIPALITY_CLUSTERS).fillna(UNKNOWN_CLUSTER)

    # These projects land here (inference.csv, not test.csv) purely because
    # no direct or proxy completion date could be resolved for RedFlag
    # labeling -- NOT because their STATUS says they're still in progress.
    # A large share (measured ~70%) of this "unresolved" population actually
    # has a STATUS confirming completion (see seed_supabase.py's map_status()
    # fix and COMPLETED_STATUS_SUBSTRINGS in feature_engineering.py for the
    # same "complet" convention). A smaller share has a STATUS confirming the
    # fund transfer was refunded rather than implemented ("Refunded"/"For
    # refund of full amount" -- same map_status() fix). meta_prob/risk_tier
    # for these rows is a genuine model prediction -- useful as a
    # retrospective/audit signal on the dashboard -- but scheduling a
    # field-inspector visit to a project that's already finished OR whose
    # funds were returned is not an actionable recommendation (see this
    # module's own docstring; there's nothing left to inspect on-site in
    # either case). Flagged here so select_priority_projects() can exclude
    # them from the scheduling candidate pool without touching the
    # dashboard's risk_tier/meta_prob values, which are computed above and
    # unaffected by this flag.
    merged["status_raw"] = merged["project_key"].map(status_lookup)
    status_lower = merged["status_raw"].astype(str).str.lower()
    merged["status_excludes_scheduling"] = (
        status_lower.str.contains("complet", na=False) | status_lower.str.contains("refund", na=False)
    )

    logger.info("Risk tier distribution across scored ongoing projects:\n%s", merged["risk_tier"].value_counts())
    logger.info(
        "%d of %d scored ongoing projects have a STATUS confirming completion or refund despite "
        "lacking a resolvable RedFlag date -- excluded from scheduling in select_priority_projects(), "
        "kept on the dashboard as a predicted (unverified) risk signal.",
        int(merged["status_excludes_scheduling"].sum()), len(merged),
    )
    return merged


# ---------------------------------------------------------------------------
# Step 2 — select the High/Critical-risk candidate pool for scheduling.
# ---------------------------------------------------------------------------


MIN_PRIORITY_PROJECTS_FOR_SCHEDULING = 10
FALLBACK_POOL_SIZE = 60  # size of the relative-risk fallback pool when tier thresholds yield too few/no projects


def select_priority_projects(
    scored_df: pd.DataFrame,
    max_projects: int = MAX_PROJECTS_CONSIDERED,
    recently_visited: Optional[set] = None,
) -> pd.DataFrame:
    """
    Selects the scheduling candidate pool from the scored ongoing-project
    population.

    COMPLETED/REFUNDED-STATUS EXCLUSION: projects whose raw STATUS confirms
    they're already completed OR that their fund transfer was refunded
    (they only ended up in the "unresolved" population because no direct/
    proxy completion date could be resolved for RedFlag labeling -- see
    score_ongoing_projects()'s status_excludes_scheduling flag) are excluded
    here, before both the tier filter and the fallback pool. Their
    meta_prob/risk_tier is still a real model prediction and is still shown
    on the dashboard as a retrospective/audit signal, but recommending a
    field-inspector visit to a project that's already finished or whose
    funds were returned is not actionable, and this module's own docstring
    says so.

    REVISIT COOLDOWN (R1): projects in `recently_visited` are dropped here,
    before both the tier filter and the fallback pool, so neither path can
    reintroduce a project that was just visited. This is what stops the solve
    from being a pure function of the current scores -- without it, nothing in
    the inputs changes between weeks, so the same projects are returned every
    week and the tier below Critical is never reached. See
    common/visit_history.py for what counts as a visit and why an assignment
    does not.

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
    n_excluded = int(scored_df.get("status_excludes_scheduling", pd.Series(False, index=scored_df.index)).sum())
    if n_excluded:
        logger.info(
            "Excluding %d STATUS-confirmed-completed/refunded project(s) from the scheduling "
            "candidate pool -- their risk_tier/meta_prob is a prediction shown on the dashboard as "
            "an audit signal, not an actionable 'still needs a site visit' recommendation.",
            n_excluded,
        )
    schedulable = scored_df[~scored_df.get("status_excludes_scheduling", pd.Series(False, index=scored_df.index))]

    # R1: drop recently-visited projects before anything else looks at the pool.
    # Applied to `schedulable` rather than to `priority` so that the relative-risk
    # fallback below cannot hand back a project this filter just removed.
    if recently_visited:
        before = len(schedulable)
        schedulable = schedulable[~schedulable["project_key"].isin(recently_visited)]
        dropped = before - len(schedulable)
        if dropped:
            logger.info(
                "Revisit cooldown excluded %d of %d schedulable project(s) visited "
                "within the cooldown window.", dropped, before,
            )

    priority = schedulable[schedulable["risk_tier"].isin(TARGET_TIERS)].copy()
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
        fallback = schedulable[schedulable["cluster"] != UNKNOWN_CLUSTER].copy()
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


# E4: raised from 25s after telemetry showed the cap was binding and costing
# real coverage. The candidate pool grew 25 -> 87 when D21's two-learner
# fallback lifted scoring coverage, and measured on that pool:
#
#     25s cap  ->  51 projects scheduled, objective 109.78
#     60s cap  ->  60 projects scheduled, objective 126.52
#    180s cap  ->  60 projects scheduled, objective 126.52
#
# The cap was costing NINE visits a week. Note what 180s does not buy: the
# solver reaches its best solution well before 60s and then spends the rest of
# the budget failing to PROVE optimality, which is a different thing from
# failing to find the answer. 60s captures the solution without paying for the
# proof.
#
# This will need revisiting again as coverage improves -- hit_time_limit in the
# run summary is the signal to watch, and it is still True at 60s.
SOLVER_TIME_LIMIT_SECONDS = 60   # CBC wall-clock cap; the z[i,c] linking constraints create a
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
    vehicle_count: int = VEHICLE_COUNT,
    weekly_budget_php: float = WEEKLY_FIELD_BUDGET_PHP,
    visit_cost_php: float = VISIT_COST_PHP,
    cluster_cost_php: float = CLUSTER_MOBILIZATION_COST_PHP,
    cost_weight: float = COST_WEIGHT,
    inspector_day_penalty: float = INSPECTOR_DAY_PENALTY,
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

    # Total deployment cost in pesos: one charge per visit, plus a mobilization
    # charge per cluster an inspector works during the week. Referenced by both
    # the objective's cost term and the budget constraint below.
    # Each cluster is priced by its real round-trip distance from the PPDO base
    # rather than a single flat charge shared by all of them.
    cluster_cost_of = resolve_cluster_costs(clusters, flat_fallback_php=cluster_cost_php)

    total_cost = (
        visit_cost_php * pulp.lpSum(x[i][p][d] for i in inspectors for p in projects for d in days)
        + pulp.lpSum(cluster_cost_of[c] * z[i][c] for i in inspectors for c in clusters)
    )

    # Objective: maximize risk-weighted coverage, minus a travel-friction
    # penalty per distinct cluster an inspector's week touches, minus
    # Chapter 3's cost term (lambda * total deployment cost). The travel
    # penalty and the cost term are kept separate on purpose: the first is a
    # routing preference expressed in objective units, the second prices the
    # same deployment in pesos and is what the budget constraint bounds.
    # sum_c y[i][d][c] is the "inspector i is in the field on day d" indicator
    # (constrained to <= 1 below), so summing it over i and d counts the
    # inspector-days the schedule consumes. Penalizing it makes the solver
    # concentrate visits into fewer days, which is what allocation efficiency
    # measures and what actually frees inspector time.
    inspector_days_used = pulp.lpSum(
        y[i][d][c] for i in inspectors for d in days for c in clusters
    )

    prob += (
        pulp.lpSum(risk_weight[p] * x[i][p][d] for i in inspectors for p in projects for d in days)
        - travel_penalty * pulp.lpSum(z[i][c] for i in inspectors for c in clusters)
        - cost_weight * total_cost
        - inspector_day_penalty * inspector_days_used
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

    # BUDGET: total weekly deployment cost may not exceed the field budget.
    prob += total_cost <= weekly_budget_php, "weekly_budget"

    # EQUIPMENT: at most `vehicle_count` inspectors deployed on any one day.
    # sum_c y[i][d][c] is already constrained to <= 1 above, so it is exactly
    # the indicator "inspector i is in the field on day d" — the vehicle pool
    # needs no additional decision variables to express.
    for d in days:
        prob += (
            pulp.lpSum(y[i][d][c] for i in inspectors for c in clusters) <= vehicle_count,
            f"vehicles_{d}",
        )

    solver = pulp.PULP_CBC_CMD(msg=False, timeLimit=SOLVER_TIME_LIMIT_SECONDS, gapRel=SOLVER_MIP_GAP)
    solve_started = time.monotonic()
    prob.solve(solver)
    solve_seconds = time.monotonic() - solve_started

    status = pulp.LpStatus[prob.status]
    objective_value = pulp.value(prob.objective) or 0.0

    # E4: record how hard the solve actually was, not just that it finished.
    #
    # The candidate pool grew from 25 to 87 when D21's two-learner fallback
    # lifted scoring coverage, and it will keep growing as coverage improves.
    # Against a 25-second cap and a 2% gap tolerance, "Optimal" can quietly
    # become "the best found before the clock ran out" -- which still returns a
    # usable schedule and still logs a status, so nothing would signal the
    # change until a solve silently truncated the week.
    #
    # Time used against the cap is the leading indicator, so it is logged every
    # solve and surfaced in the summary rather than left in the log.
    time_used_pct = 100.0 * solve_seconds / SOLVER_TIME_LIMIT_SECONDS
    hit_time_limit = solve_seconds >= SOLVER_TIME_LIMIT_SECONDS * 0.95

    log = logger.warning if (hit_time_limit or status != "Optimal") else logger.info
    log(
        "Solver status: %s | objective %.4f | %d candidates, %d binary vars | "
        "%.1fs of the %ds cap (%.0f%%)%s",
        status, objective_value, len(projects),
        len(projects) * len(inspectors) * len(days),
        solve_seconds, SOLVER_TIME_LIMIT_SECONDS, time_used_pct,
        " — AT THE TIME LIMIT: the result is the best found before the clock "
        "ran out, not a proven optimum. Raise SOLVER_TIME_LIMIT_SECONDS or "
        "reduce MAX_PROJECTS_CONSIDERED." if hit_time_limit else "",
    )

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

    # Realized cost and how hard the two new constraints bound, so a reader can
    # see whether budget or vehicles actually shaped this particular solve.
    realized_cost = visit_cost_php * len(schedule_df) + sum(
        cluster_cost_of[c]
        for i in inspectors
        for c in clusters
        if (pulp.value(z[i][c]) or 0) > 0.5
    )
    max_inspectors_deployed = 0
    if not schedule_df.empty:
        max_inspectors_deployed = int(schedule_df.groupby("day")["inspector"].nunique().max())
    summary.update({
        "total_cost_php": round(realized_cost, 2),
        "weekly_budget_php": weekly_budget_php,
        "budget_utilization": round(realized_cost / weekly_budget_php, 4) if weekly_budget_php else None,
        "vehicle_count": vehicle_count,
        "max_inspectors_deployed_in_a_day": max_inspectors_deployed,
        "allocation_efficiency": allocation_efficiency(schedule_df),
        "solve_seconds": round(solve_seconds, 2),
        "solve_time_limit_seconds": SOLVER_TIME_LIMIT_SECONDS,
        "solve_time_used_pct": round(time_used_pct, 1),
        "hit_time_limit": hit_time_limit,
        "cluster_mobilization_costs_php": cluster_cost_of,
        "inspector_days_used": (
            int(schedule_df.groupby(["inspector", "day"]).ngroups) if not schedule_df.empty else 0
        ),
    })
    return schedule_df, summary


# ---------------------------------------------------------------------------
# Orchestration
# ---------------------------------------------------------------------------


def aging_alpha() -> float:
    """Aging strength from ML_SERVICE_AGING_ALPHA. 0.0 (the default) reproduces
    the pre-R2 objective exactly, so this ships inert until deliberately set."""
    raw = (os.environ.get("ML_SERVICE_AGING_ALPHA") or "").strip()
    if not raw:
        return 0.0
    try:
        value = float(raw)
    except ValueError:
        logger.warning(
            "ML_SERVICE_AGING_ALPHA=%r is not a number — aging stays off.", raw
        )
        return 0.0
    if value < 0:
        logger.warning(
            "ML_SERVICE_AGING_ALPHA=%s is negative, which would penalise waiting "
            "rather than reward it — aging stays off.", value
        )
        return 0.0
    return value


def run(output_path: str) -> None:
    scored_df = score_ongoing_projects()

    # R1: projects visited within the cooldown window leave this week's pool.
    # The provenance dict travels into the run summary so a schedule records
    # whether a cooldown was applied at all -- a solve run without one (no
    # Supabase, or the cooldown disabled) must not be mistakable for a solve
    # run with one.
    visited, cooldown_provenance = recently_visited_keys()

    priority_df = select_priority_projects(scored_df, recently_visited=visited)

    # R2: age the objective so waiting accumulates priority. alpha defaults to
    # 0.0, which is exactly the pre-R2 pipeline -- this is opt-in, and the
    # control arm of the Chapter 4 ablation.
    alpha = aging_alpha()
    if alpha:
        priority_df = apply_aging(
            priority_df, last_visit_dates(), alpha=alpha,
            window_weeks=DEFAULT_WINDOW_WEEKS,
        )

    schedule_df, summary = build_and_solve_schedule(priority_df)
    summary["revisit_cooldown"] = cooldown_provenance
    summary["aging"] = {
        "alpha": alpha,
        "window_weeks": DEFAULT_WINDOW_WEEKS,
        "applied": bool(alpha),
    }

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
        # Same path the API's background task writes, so a CLI run and a
        # /api/v1/run-optimizer run cannot disagree about where the schedule is.
        default=str(SCHEDULE_CSV_PATH),
        help="Output CSV path for the weekly inspector deployment schedule.",
    )
    args = parser.parse_args()
    run(args.output)


if __name__ == "__main__":
    main()
