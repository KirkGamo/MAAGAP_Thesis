/**
 * Mirror of ml-service/optimization_engine.py's logistical baseline
 * (DAILY_CAPACITY / WEEKLY_CAPACITY, its "PPDO staffing / capacity
 * assumptions" block). The solver enforces these as hard constraints;
 * the workspace surfaces them as capacity chips and soft warnings on
 * manual edits -- soft because on the frontend they are planning
 * assumptions a Manager may consciously override, not laws. Keep in sync
 * by hand; they change together with the thesis's Chapter 3 assumptions,
 * not casually.
 */
export const DAILY_CAPACITY = 3;
export const WEEKLY_CAPACITY = 12;
