"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { currentWeekMonday } from "@/lib/current-week";

interface ScheduleRow {
  inspector: string;
  day: string;
  project_key: string;
  project_name: string;
  municipality: string;
  cluster: string;
  risk_tier: string;
  meta_prob: string;
}

interface LatestScheduleResponse {
  rows: ScheduleRow[];
  summary: Record<string, unknown> | null;
}

/**
 * Mirrors ml-service/optimization_engine.py's most recent PuLP solve
 * output (served as JSON by ml-service/main.py's GET /api/v1/latest-schedule,
 * which reads artifacts/inspector_schedule.csv) into the `inspector_schedules`
 * table, so the Manager and Inspector portals can read it from Supabase
 * like any other data.
 *
 * Two mappings have to happen for this to work at all:
 *   1. Each CSV row's `inspector` label ("Inspector_1".."Inspector_6") ->
 *      a real `profiles.id`, via `profiles.inspector_slug` (see
 *      app/manager/inspectors/slug-field.tsx -- a Manager assigns these
 *      from the Inspectors tab). Rows whose slug has no assigned profile
 *      are skipped, not silently dropped -- the returned result reports
 *      how many.
 *   2. Each row's `project_key` -> a real `projects.id`, resolved with a
 *      single batched `.in()` query. Rows whose project_key doesn't exist
 *      in `projects` yet (e.g. it hasn't been imported via /manager/import)
 *      are likewise skipped and counted.
 *
 * "Deploy latest schedule" replaces the ENTIRE current week's schedule --
 * existing inspector_schedules rows for this week are deleted first, then
 * every successfully-mapped row from the CSV is inserted fresh. This
 * matches the button's own label ("deploy LATEST") rather than
 * accumulating duplicate rows on every click.
 */
export async function deployLatestSchedule(): Promise<
  | { success: true; message: string }
  | { success: false; error: string }
> {
  const baseUrl = process.env.FASTAPI_ML_SERVICE_URL;
  if (!baseUrl) {
    return {
      success: false,
      error:
        "FASTAPI_ML_SERVICE_URL is not configured -- set it in frontend/.env.local (e.g. http://localhost:8000 for local dev) so this action can reach the ML service.",
    };
  }

  let data: LatestScheduleResponse;
  try {
    const res = await fetch(`${baseUrl}/api/v1/latest-schedule`, { cache: "no-store" });
    if (res.status === 404) {
      return {
        success: false,
        error:
          "No inspector schedule found yet -- run ml-service/optimization_engine.py first, then try again.",
      };
    }
    if (!res.ok) {
      return { success: false, error: `ML service returned ${res.status}.` };
    }
    data = (await res.json()) as LatestScheduleResponse;
  } catch (err) {
    return {
      success: false,
      error: `Could not reach the ML service at ${baseUrl}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    };
  }

  if (data.rows.length === 0) {
    return { success: false, error: "The latest schedule has no rows to deploy." };
  }

  const supabase = await createClient();

  const slugs = Array.from(new Set(data.rows.map((r) => r.inspector)));
  const projectKeys = Array.from(new Set(data.rows.map((r) => r.project_key)));

  const [{ data: inspectorProfiles }, { data: projectRows }] = await Promise.all([
    supabase.from("profiles").select("id, inspector_slug").in("inspector_slug", slugs),
    supabase.from("projects").select("id, project_key").in("project_key", projectKeys),
  ]);

  const inspectorIdBySlug = new Map(
    (inspectorProfiles ?? [])
      .filter((p) => p.inspector_slug)
      .map((p) => [p.inspector_slug as string, p.id])
  );
  const projectIdByKey = new Map((projectRows ?? []).map((p) => [p.project_key, p.id]));

  const weekOf = currentWeekMonday();
  const toInsert: {
    project_id: string;
    inspector_id: string;
    scheduled_day: string;
    week_of: string;
    cluster: string;
  }[] = [];

  let skippedUnmappedInspector = 0;
  let skippedUnknownProject = 0;

  for (const row of data.rows) {
    const inspectorId = inspectorIdBySlug.get(row.inspector);
    const projectId = projectIdByKey.get(row.project_key);

    if (!inspectorId) {
      skippedUnmappedInspector += 1;
      continue;
    }
    if (!projectId) {
      skippedUnknownProject += 1;
      continue;
    }

    toInsert.push({
      project_id: projectId,
      inspector_id: inspectorId,
      scheduled_day: row.day,
      week_of: weekOf,
      cluster: row.cluster,
    });
  }

  if (toInsert.length === 0) {
    return {
      success: false,
      error:
        `None of the ${data.rows.length} schedule row(s) could be deployed -- ` +
        `${skippedUnmappedInspector} had no inspector mapped to their "Inspector_N" slot ` +
        `(assign one on the Inspectors tab) and ${skippedUnknownProject} referenced a project ` +
        `not yet imported (use Import Projects on the PPAs tab).`,
    };
  }

  // Replace the week wholesale rather than accumulating duplicates on
  // every "Deploy" click.
  const { error: deleteError } = await supabase
    .from("inspector_schedules")
    .delete()
    .eq("week_of", weekOf);

  if (deleteError) {
    return { success: false, error: `Could not clear the existing schedule: ${deleteError.message}` };
  }

  const { error: insertError } = await supabase.from("inspector_schedules").insert(toInsert);

  if (insertError) {
    return { success: false, error: `Could not save the new schedule: ${insertError.message}` };
  }

  revalidatePath("/manager/schedule");
  revalidatePath("/inspector");

  const skippedParts: string[] = [];
  if (skippedUnmappedInspector > 0) {
    skippedParts.push(`${skippedUnmappedInspector} skipped (unmapped inspector slot)`);
  }
  if (skippedUnknownProject > 0) {
    skippedParts.push(`${skippedUnknownProject} skipped (project not imported)`);
  }

  return {
    success: true,
    message:
      `Deployed ${toInsert.length} assignment(s) for the week of ${weekOf}` +
      (skippedParts.length > 0 ? ` — ${skippedParts.join(", ")}.` : "."),
  };
}
