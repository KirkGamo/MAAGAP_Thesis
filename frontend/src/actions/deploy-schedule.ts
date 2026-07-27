"use server";

import { revalidatePath } from "next/cache";

/**
 * PLACEHOLDER — mirrors ml-service/artifacts/inspector_schedule.csv (the
 * PuLP solve's output) into the `inspector_schedules` table so the Manager
 * and Inspector portals can read it from Supabase like any other data.
 *
 * NOT YET IMPLEMENTED: the real version of this action should
 *   1. Call the FastAPI ML service (FASTAPI_ML_SERVICE_URL) at an endpoint
 *      that runs/serves `optimization_engine.py`'s latest output as JSON
 *      (the CSV columns are: inspector, day, project_key, project_name,
 *      municipality, cluster, risk_tier, meta_prob).
 *   2. Resolve each `inspector` label (currently "Inspector_1".."Inspector_6"
 *      in the Python script) to a real `profiles.id` — this requires a
 *      naming/assignment convention between the optimization engine and
 *      the `profiles` table that does not exist yet (e.g. a
 *      `profiles.inspector_slug` column, or passing real profile UUIDs
 *      into optimization_engine.py's INSPECTOR_IDS instead of synthetic
 *      labels).
 *   3. Resolve each `project_key` to the matching `projects.id` row
 *      (importing it first via /manager/import if it doesn't exist yet).
 *   4. Upsert the resulting rows into `inspector_schedules`, scoped to the
 *      current ISO week (`week_of`).
 *
 * This stub exists so the Schedule page has something to wire a real
 * Server Action to, and so the intended data flow is documented in one
 * place rather than only in prose.
 */
export async function deployLatestSchedule(): Promise<
  { success: true; message: string } | { success: false; error: string }
> {
  revalidatePath("/manager/schedule");
  return {
    success: false,
    error:
      "Not yet implemented — wire this action to the FastAPI ML service's schedule endpoint. See this file's module docstring for the required steps.",
  };
}
