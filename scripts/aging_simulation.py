"""
MAAGAP — multi-week simulation of the aging term (R2's measurement)
================================================================================
Produces the Chapter 4 ablation: how allocation efficiency trades off against
coverage of the High tier as the aging strength alpha varies.

WHY A SIMULATION AND NOT A SINGLE-WEEK SWEEP
------------------------------------------------------------------------------
The plan originally called for solving once per alpha and plotting the result.
That measures nothing. Aging rewards waiting, and 85 of the 100 High/Critical
projects have never been visited — so they all share the same waiting time, the
normalisation returns 1.0 for every one of them, and alpha has no effect. The
sweep would be a flat line, correctly.

Aging only redistributes priority once histories DIFFER, which happens across
weeks: this week's visits become next week's cooldown and next week's lower
aging multiplier. So the experiment has to run the loop.

Each simulated week:
    1. select the candidate pool, excluding projects visited inside the cooldown
    2. age the objective by alpha against the visit history so far
    3. solve
    4. record the schedule AS VISITS, feeding step 1 of the following week

WHAT IS SIMULATED AND WHAT IS NOT
------------------------------------------------------------------------------
Risk scores are held FIXED at their current values for the whole run. Re-scoring
each week would mean every project's elapsed-time features advanced, which (see
HANDOFF, the ratchet) pushes risk monotonically upward and would confound the
thing being measured: changes in tier coverage caused by aging would be
indistinguishable from changes caused by the calendar. Holding scores fixed
isolates the scheduler, which is what the ablation is about.

Consequently this measures the ALLOCATION POLICY, not the full system's
behaviour over a real quarter. Chapter 4 should say so.

Assumes every scheduled visit happens. Real inspectors miss visits, and a missed
visit does not start a cooldown (see common/visit_history.py) -- so a real
deployment would cycle more slowly than this simulation does.

    python scripts/aging_simulation.py --weeks 8 --alphas 0 0.5 1 2
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
import time
from pathlib import Path

import pandas as pd

REPO_ROOT = Path(__file__).resolve().parent.parent
ML_DIR = REPO_ROOT / "ml-service"
sys.path.insert(0, str(ML_DIR))
sys.path.insert(0, str(ML_DIR / "models"))

logging.basicConfig(level=logging.ERROR, format="%(message)s")
logger = logging.getLogger("aging_simulation")


def simulate(oe, aging, scored_df, alpha: float, weeks: int,
             cooldown_days: int, window_weeks: float) -> dict:
    """Run `weeks` consecutive solves, feeding each week's schedule back as
    visit history for the next."""
    last_visits: dict[str, pd.Timestamp] = {}
    start = pd.Timestamp("2026-01-05", tz="UTC")  # an arbitrary fixed Monday
    weekly = []

    for week in range(weeks):
        today = start + pd.Timedelta(weeks=week)

        cutoff = today - pd.Timedelta(days=cooldown_days)
        on_cooldown = {k for k, v in last_visits.items() if v >= cutoff}

        pool = oe.select_priority_projects(scored_df, recently_visited=on_cooldown)
        if pool.empty:
            weekly.append({"week": week + 1, "scheduled": 0, "high": 0,
                           "critical": 0, "efficiency": None, "objective": None})
            continue

        if alpha:
            pool = aging.apply_aging(
                pool, last_visits, alpha=alpha,
                window_weeks=window_weeks, now=today,
            )

        schedule_df, summary = oe.build_and_solve_schedule(pool)

        # An empty schedule has no columns at all, so every later access by name
        # raises KeyError rather than returning nothing. The solver can return
        # one legitimately -- a pool that is non-empty but entirely unschedulable
        # under the budget and capacity constraints -- so this is a real state,
        # not a defensive guard.
        if schedule_df.empty or "project_key" not in schedule_df.columns:
            weekly.append({"week": week + 1, "scheduled": 0, "high": 0,
                           "critical": 0, "efficiency": None, "objective": None,
                           "on_cooldown": len(on_cooldown)})
            continue

        tiers = schedule_df["risk_tier"].value_counts().to_dict()
        weekly.append(
            {
                "week": week + 1,
                "scheduled": int(len(schedule_df)),
                "high": int(tiers.get("High", 0)),
                "critical": int(tiers.get("Critical", 0)),
                "efficiency": summary.get("allocation_efficiency"),
                "objective": summary.get("objective_value"),
                "on_cooldown": len(on_cooldown),
            }
        )

        for key in schedule_df["project_key"]:
            last_visits[key] = today

    visited_keys = set(last_visits)
    actionable = scored_df[scored_df["risk_tier"].isin(oe.TARGET_TIERS)]
    high_keys = set(actionable[actionable["risk_tier"] == "High"]["project_key"])

    effs = [w["efficiency"] for w in weekly if w["efficiency"] is not None]
    return {
        "alpha": alpha,
        "weeks": weekly,
        "distinct_projects_visited": len(visited_keys),
        "high_tier_total": len(high_keys),
        "high_tier_reached": len(high_keys & visited_keys),
        "high_tier_coverage": round(len(high_keys & visited_keys) / len(high_keys), 4) if high_keys else None,
        "mean_efficiency": round(sum(effs) / len(effs), 4) if effs else None,
        "total_visits": sum(w["scheduled"] for w in weekly),
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--weeks", type=int, default=8)
    ap.add_argument("--alphas", type=float, nargs="+", default=[0.0, 0.5, 1.0, 2.0])
    ap.add_argument(
        "--cooldowns", type=int, nargs="+", default=[28],
        help="Cooldown windows to cross with --alphas. 0 disables the "
             "cooldown, which is how the aging-alone arm is expressed.",
    )
    ap.add_argument("--window-weeks", type=float, default=12.0)
    ap.add_argument("--time-limit", type=int, default=20,
                    help="CBC cap per solve. Lower than production's 60s because "
                         "a sweep is weeks x alphas solves; the solver is "
                         "deterministic, so this trades solution quality for "
                         "runtime without adding noise.")
    ap.add_argument(
        "--score-cache", type=Path, default=None,
        help="Cache the scored population here. Scoring costs ~60s and is "
             "identical for every arm, so a split sweep pays it once.",
    )
    ap.add_argument(
        "--append", action="store_true",
        help="Merge these arms into an existing --out instead of overwriting. "
             "A sweep too long for one process is run arm by arm and "
             "accumulated.",
    )
    ap.add_argument("--out", type=Path,
                    default=ML_DIR / "artifacts" / "aging_simulation.json")
    args = ap.parse_args()

    import optimization_engine as oe
    from common import aging

    oe.SOLVER_TIME_LIMIT_SECONDS = args.time_limit

    t0 = time.time()
    if args.score_cache and args.score_cache.exists():
        scored = pd.read_pickle(args.score_cache)
        print(f"Loaded {len(scored)} scored projects from cache "
              f"({time.time() - t0:.0f}s). Every arm must see the identical "
              "population, which is what the cache guarantees across a split "
              "sweep.")
    else:
        print("Scoring once; every arm sees the identical population.")
        scored = oe.score_ongoing_projects()
        if args.score_cache:
            args.score_cache.parent.mkdir(parents=True, exist_ok=True)
            scored.to_pickle(args.score_cache)
            print(f"  cached to {args.score_cache}")
        print(f"  {len(scored)} projects scored ({time.time() - t0:.0f}s)")

    solves = args.weeks * len(args.alphas) * len(args.cooldowns)
    print(f"{solves} solves at {args.time_limit}s each "
          f"(~{solves * args.time_limit / 60:.0f} min)\n")

    results = []
    for cooldown in args.cooldowns:
        for alpha in args.alphas:
            print(f"=== cooldown={cooldown}d alpha={alpha} ===")
            res = simulate(oe, aging, scored, alpha, args.weeks,
                           cooldown, args.window_weeks)
            res["cooldown_days"] = cooldown
            results.append(res)
            for w in res["weeks"]:
                print(f"  week {w['week']:>2}: {w['scheduled']:>3} visits  "
                      f"High {w['high']:>3}  Critical {w['critical']:>3}  "
                      f"eff {w['efficiency']}")
            print(f"  -> High reached {res['high_tier_reached']}/"
                  f"{res['high_tier_total']}  mean eff {res['mean_efficiency']}")
            print()

    print("=" * 78)
    print(f"  {'cooldown':>9} {'alpha':>6} {'visits':>7} {'distinct':>9} "
          f"{'High reached':>13} {'mean eff':>9}")
    print("=" * 78)
    for r in results:
        print(f"  {str(r['cooldown_days']) + 'd':>9} {r['alpha']:>6} "
              f"{r['total_visits']:>7} {r['distinct_projects_visited']:>9} "
              f"{r['high_tier_reached']:>6}/{r['high_tier_total']:<6} "
              f"{r['mean_efficiency']:>9}")
    print("=" * 78)
    print()
    print()
    print("  cooldown=0 alpha=0 is the pre-R1 system.")
    print("  cooldown=28 alpha=0 is what ships today.")
    print("  The arm worth reading is cooldown=0 with a positive alpha:")
    print("  aging alone, banning nothing.")
    print("\n  Read this as the trade-off: aging buys High-tier coverage with")
    print("  allocation efficiency. Which point on the curve PPDO wants is a")
    print("  policy choice, not a modelling one.")

    payload = {
        "weeks": args.weeks,
        "cooldown_days_swept": args.cooldowns,
        "window_weeks": args.window_weeks,
        "solver_time_limit_seconds": args.time_limit,
        "scores": "held fixed across weeks; see module docstring",
        "arms": results,
    }
    if args.append and args.out.exists():
        prior = json.loads(args.out.read_text(encoding="utf-8"))
        seen = {(a["cooldown_days"], a["alpha"]) for a in payload["arms"]}
        kept = [a for a in prior.get("arms", [])
                if (a.get("cooldown_days"), a.get("alpha")) not in seen]
        payload["arms"] = kept + payload["arms"]
        print(f"  merged with {len(kept)} previously recorded arm(s)")
    args.out.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print()
    print(f"wrote {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
