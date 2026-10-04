"""
MAAGAP — how much does the CBC solve vary run to run? (prerequisite for R2)
================================================================================
R2 proposes an aging term in the allocation objective, with alpha swept to plot
the trade-off between retiring known risk and surveilling emerging risk. That
ablation is only meaningful if the solver's own run-to-run variation is smaller
than the effect alpha produces. Two observed solves suggest it may not be:

    89 candidates -> objective 128.81, 60 scheduled
    87 candidates -> objective 117.38, 57 scheduled   (R1 cooldown removed two)

Removing two Critical candidates can cost at most 2 x 2.5 = 5.0 of objective, so
at least 6.4 of that 11.44 drop is solver suboptimality rather than the input
change. Both runs reported hit_time_limit at ~100% of the 60s cap, so neither is
a proven optimum.

WHY A WALL-CLOCK LIMIT MAKES THIS NON-DETERMINISTIC
------------------------------------------------------------------------------
CBC's branch-and-bound explores in a deterministic order for a given model, but
`timeLimit` cuts that exploration by WALL CLOCK. How many nodes fit inside 60
seconds depends on machine load, so the same model solved twice can stop at
different points and return different incumbents. The variation measured here is
therefore a property of the time box, not of the optimiser being randomised.

WHAT THIS MEASURES
------------------------------------------------------------------------------
The candidate pool is scored and selected ONCE and reused for every solve, so
the only thing changing between runs is the solver. For each time limit it
reports the objective spread, the schedule size spread, and how stable the
chosen SET of projects is across runs (mean pairwise Jaccard) -- because two
solves can reach the same objective while recommending different site visits,
and for an operational schedule that difference matters on its own.

    python scripts/solver_variance_study.py --repeats 5 --limits 60 180
"""

from __future__ import annotations

import argparse
import itertools
import json
import logging
import statistics
import sys
import time
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
ML_DIR = REPO_ROOT / "ml-service"
sys.path.insert(0, str(ML_DIR))
sys.path.insert(0, str(ML_DIR / "models"))

logging.basicConfig(level=logging.WARNING, format="%(asctime)s %(message)s")
logger = logging.getLogger("solver_variance")


def jaccard(a: set, b: set) -> float:
    union = a | b
    return len(a & b) / len(union) if union else 1.0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--repeats", type=int, default=5)
    ap.add_argument("--limits", type=int, nargs="+", default=[60, 180])
    ap.add_argument(
        "--out",
        type=Path,
        default=ML_DIR / "artifacts" / "solver_variance_study.json",
    )
    args = ap.parse_args()

    import optimization_engine as oe

    print("Scoring the population once, so every solve sees an identical pool...")
    t0 = time.time()
    scored = oe.score_ongoing_projects()
    # No cooldown: this measures the solver, and a cooldown would make the pool
    # depend on whatever visit history happens to exist today.
    priority = oe.select_priority_projects(scored)
    print(f"  pool: {len(priority)} candidates across "
          f"{priority['cluster'].nunique()} clusters ({time.time() - t0:.0f}s)\n")

    original_limit = oe.SOLVER_TIME_LIMIT_SECONDS
    results: dict[str, list[dict]] = {}

    try:
        for limit in args.limits:
            oe.SOLVER_TIME_LIMIT_SECONDS = limit
            runs: list[dict] = []
            print(f"=== time limit {limit}s, {args.repeats} repeat(s) ===")
            for i in range(args.repeats):
                started = time.time()
                schedule_df, summary = oe.build_and_solve_schedule(priority)
                runs.append(
                    {
                        "objective": summary.get("objective_value"),
                        "scheduled": summary.get("projects_scheduled"),
                        "efficiency": summary.get("allocation_efficiency"),
                        "solve_seconds": summary.get("solve_seconds"),
                        "hit_time_limit": summary.get("hit_time_limit"),
                        "keys": sorted(schedule_df["project_key"].tolist()),
                        "wall": round(time.time() - started, 1),
                    }
                )
                r = runs[-1]
                print(f"  run {i + 1}: objective {r['objective']:.4f}  "
                      f"scheduled {r['scheduled']}  "
                      f"solve {r['solve_seconds']}s  "
                      f"hit_limit={r['hit_time_limit']}")
            results[str(limit)] = runs
            print()
    finally:
        oe.SOLVER_TIME_LIMIT_SECONDS = original_limit

    # ---- report ------------------------------------------------------------
    print("=" * 72)
    print(f"  {'limit':>6} {'n':>3} {'obj mean':>10} {'obj sd':>8} {'spread':>8} "
          f"{'sched':>9} {'jaccard':>8}")
    print("=" * 72)

    summary_rows = []
    for limit, runs in results.items():
        objs = [r["objective"] for r in runs]
        scheds = [r["scheduled"] for r in runs]
        key_sets = [set(r["keys"]) for r in runs]
        pairs = list(itertools.combinations(key_sets, 2))
        mean_j = statistics.fmean(jaccard(a, b) for a, b in pairs) if pairs else 1.0
        sd = statistics.stdev(objs) if len(objs) > 1 else 0.0
        spread = max(objs) - min(objs)
        row = {
            "time_limit_seconds": int(limit),
            "repeats": len(runs),
            "objective_mean": round(statistics.fmean(objs), 4),
            "objective_sd": round(sd, 4),
            "objective_spread": round(spread, 4),
            "objective_min": round(min(objs), 4),
            "objective_max": round(max(objs), 4),
            "scheduled_min": min(scheds),
            "scheduled_max": max(scheds),
            "mean_pairwise_jaccard": round(mean_j, 4),
            "all_hit_time_limit": all(r["hit_time_limit"] for r in runs),
        }
        summary_rows.append(row)
        print(f"  {limit:>6} {len(runs):>3} {row['objective_mean']:>10.4f} "
              f"{sd:>8.4f} {spread:>8.4f} "
              f"{min(scheds)}-{max(scheds):<7} {mean_j:>8.4f}")

    print("=" * 72)

    # ---- the verdict R2 needs ---------------------------------------------
    baseline = next((r for r in summary_rows if r["time_limit_seconds"] == 60), summary_rows[0])
    detectable = baseline["objective_spread"]
    print()
    print("  WHAT THIS MEANS FOR R2")
    print(f"  At the production {baseline['time_limit_seconds']}s cap the objective varies by "
          f"{detectable:.2f} across identical inputs.")
    print(f"  An alpha sweep must therefore produce effects LARGER than {detectable:.2f} "
          "to be")
    print("  distinguishable from solver noise, or average over repeated solves.")
    if baseline["mean_pairwise_jaccard"] < 0.95:
        print(f"  Note also that the SCHEDULE itself is unstable: mean pairwise Jaccard "
              f"{baseline['mean_pairwise_jaccard']:.3f}")
        print("  across identical inputs, so the same week can yield materially different "
              "site visits.")

    args.out.write_text(
        json.dumps(
            {
                "candidate_pool": int(len(priority)),
                "by_time_limit": summary_rows,
                "runs": {k: [{kk: vv for kk, vv in r.items() if kk != "keys"} for r in v]
                         for k, v in results.items()},
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    print(f"\nwrote {args.out.relative_to(REPO_ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
