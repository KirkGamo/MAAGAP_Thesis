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

interface InsertableAssignment {
  project_id: string;
  inspector_id: string;
  scheduled_day: string;
  week_of: string;
  cluster: string;
}

interface MappedSchedule {
  toInsert: InsertableAssignment[];
  skippedUnmappedInspector: number;
  skippedUnknownProject: number;
  totalRows: number;
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
 * accumulating duplicate rows on every click. Because that delete also
 * wipes any manual edits made through the workspace, previewDeploy()
 * (below) lets the button warn before this action runs -- see
 * SCHEDULE_WORKFLOW_IMPROVEMENT_PLAN.md phase 4.
 */
async function fetchAndMapLatestSchedule(
  supabase: Awaited<ReturnType<typeof createClient>>
): Promise<{ ok: true; mapped: MappedSchedule } | { ok: false; error: string }> {
  const baseUrl = process.env.FASTAPI_ML_SERVICE_URL;
  if (!baseUrl) {
    return {
      ok: false,
      error:
        "FASTAPI_ML_SERVICE_URL is not configured -- set it in frontend/.env.local (e.g. http://localhost:8000 for local dev) so this action can reach the ML service.",
    };
  }

  let data: LatestScheduleResponse;
  try {
    const res = await fetch(`${baseUrl}/api/v1/latest-schedule`, { cache: "no-store" });
    if (res.status === 404) {
      return {
        ok: false,
        error: "No inspector schedule found yet -- run the optimizer first, then try again.",
      };
    }
    if (!res.ok) {
      return { ok: false, error: `ML service returned ${res.status}.` };
    }
    data = (await res.json()) as LatestScheduleResponse;
  } catch (err) {
    return {
      ok: false,
      error: `Could not reach the ML service at ${baseUrl}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    };
  }

  if (data.rows.length === 0) {
    return { ok: false, error: "The latest schedule has no rows to deploy." };
  }

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
  const toInsert: InsertableAssignment[] = [];

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

  return {
    ok: true,
    mapped: {
      toInsert,
      skippedUnmappedInspector,
      skippedUnknownProject,
      totalRows: data.rows.length,
    },
  };
}

function noneDeployableError(mapped: MappedSchedule): string {
  return (
    `None of the ${mapped.totalRows} schedule row(s) could be deployed -- ` +
    `${mapped.skippedUnmappedInspector} had no inspector mapped to their "Inspector_N" slot ` +
    `(assign one on the Inspectors tab) and ${mapped.skippedUnknownProject} referenced a project ` +
    `not yet imported (use Import Projects on the PPAs tab).`
  );
}

export interface DeployPreview {
  /** Successfully mapped rows that would be inserted. */
  incoming: number;
  /** Rows in the optimizer's output, mapped or not. */
  totalRows: number;
  /** Rows that cannot be deployed because their "Inspector_N" slot has no
   * profile (assign slugs on the Inspectors tab). */
  skippedUnmappedInspector: number;
  /** Rows whose project_key isn't in `projects` yet. */
  skippedUnknownProject: number;
  /** Current-week rows that the deploy would delete first. */
  existing: number;
  /** Of those, rows that differ from the incoming optimizer output --
   * the closest available proxy for "manual edits that will be lost"
   * (the schema doesn't record who created a row). */
  differing: number;
}

/**
 * Phase 4: what would deploying do? Lets the button warn before the
 * replace-week delete wipes manual edits. Read-only.
 */
export async function previewDeploy(): Promise<
  { success: true; preview: DeployPreview } | { success: false; error: string }
> {
  const supabase = await createClient();
  const result = await fetchAndMapLatestSchedule(supabase);
  if (!result.ok) return { success: false, error: result.error };
  if (result.mapped.toInsert.length === 0) {
    return { success: false, error: noneDeployableError(result.mapped) };
  }

  const { data: existingRows, error } = await supabase
    .from("inspector_schedules")
    .select("project_id, inspector_id, scheduled_day")
    .eq("week_of", currentWeekMonday());

  if (error) {
    return { success: false, error: error.message };
  }

  const incomingKeys = new Set(
    result.mapped.toInsert.map((r) => `${r.project_id}|${r.inspector_id}|${r.scheduled_day}`)
  );
  const existing = existingRows?.length ?? 0;
  const differing = (existingRows ?? []).filter(
    (r) => !incomingKeys.has(`${r.project_id}|${r.inspector_id}|${r.scheduled_day}`)
  ).length;

  return {
    success: true,
    preview: {
      incoming: result.mapped.toInsert.length,
      totalRows: result.mapped.totalRows,
      skippedUnmappedInspector: result.mapped.skippedUnmappedInspector,
      skippedUnknownProject: result.mapped.skippedUnknownProject,
      existing,
      differing,
    },
  };
}

export async function deployLatestSchedule(): Promise<
  | { success: true; message: string }
  | { success: false; error: string }
> {
  const supabase = await createClient();
  const result = await fetchAndMapLatestSchedule(supabase);
  if (!result.ok) return { success: false, error: result.error };

  const { toInsert, skippedUnmappedInspector, skippedUnknownProject } = result.mapped;

  if (toInsert.length === 0) {
    return { success: false, error: noneDeployableError(result.mapped) };
  }

  const weekOf = currentWeekMonday();

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
