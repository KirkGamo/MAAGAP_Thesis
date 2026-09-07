"use server";

/**
 * MAAGAP — Phase 12.2: manual schedule editing.
 *
 * "Deploy latest schedule" (actions/deploy-schedule.ts) publishes the PuLP
 * solve's output wholesale. This file lets a Manager override that result
 * afterwards -- reassign an assignment to a different inspector or day,
 * remove one entirely, or add a manual assignment the optimizer didn't
 * produce (or that the Manager wants regardless of what it produced).
 *
 * No new RLS policy was needed for this: "schedules: managers full access"
 * (supabase/schema.sql) already grants managers full INSERT/UPDATE/DELETE
 * on inspector_schedules, same as every other write in this codebase --
 * RLS is the enforcement layer, not application code (see actions/
 * inspectors.ts's docstring for the established pattern).
 *
 * The new unique(project_id, scheduled_day, week_of) constraint (see
 * add_inspector_schedules_unique.sql) is what makes updateAssignment safe:
 * without it, reassigning a project onto a day/week where it's already
 * scheduled (via a different inspector) would silently create a duplicate
 * visit instead of failing loudly.
 */

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { currentWeekMonday } from "@/lib/current-week";

export type ScheduleActionResult =
  | { success: true; message?: string }
  | { success: false; error: string };

const VALID_DAYS = new Set(["Mon", "Tue", "Wed", "Thu", "Fri"]);

function revalidateScheduleViews() {
  revalidatePath("/manager/schedule");
  revalidatePath("/inspector");
}

function duplicateAssignmentMessage(): string {
  return "That project is already scheduled on that day this week -- change the existing assignment instead of creating a duplicate.";
}

/**
 * Reassigns an existing inspector_schedules row to a different inspector
 * and/or day. Both fields are optional so the same action can be called
 * from either the inspector <select> or the day <select> without the
 * caller needing to know the row's other current value.
 */
export async function updateAssignment(
  id: string,
  updates: { inspectorId?: string; scheduledDay?: string }
): Promise<ScheduleActionResult> {
  if (updates.scheduledDay && !VALID_DAYS.has(updates.scheduledDay)) {
    return { success: false, error: `"${updates.scheduledDay}" is not a valid day.` };
  }

  const patch: { inspector_id?: string; scheduled_day?: string } = {};
  if (updates.inspectorId) patch.inspector_id = updates.inspectorId;
  if (updates.scheduledDay) patch.scheduled_day = updates.scheduledDay;

  if (Object.keys(patch).length === 0) {
    return { success: false, error: "Nothing to update." };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("inspector_schedules").update(patch).eq("id", id);

  if (error) {
    if (error.code === "23505") {
      return { success: false, error: duplicateAssignmentMessage() };
    }
    return { success: false, error: error.message };
  }

  revalidateScheduleViews();
  return { success: true };
}

/** Removes a single assignment (e.g. the Manager decides that site visit
 * shouldn't happen this week at all). */
export async function removeAssignment(id: string): Promise<ScheduleActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("inspector_schedules").delete().eq("id", id);

  if (error) {
    return { success: false, error: error.message };
  }

  revalidateScheduleViews();
  return { success: true };
}

/**
 * Adds a manual assignment for the current week -- e.g. a project the
 * optimizer didn't schedule at all, or a re-add after the Manager removed
 * one by mistake. Takes a project_key (not a project_id) because that's
 * what a Manager can read straight off the PPAs tab, matching the same
 * lookup-by-key pattern actions/deploy-schedule.ts uses for the CSV import
 * path.
 */
export async function addAssignment(input: {
  projectKey: string;
  inspectorId: string;
  scheduledDay: string;
  cluster?: string;
}): Promise<ScheduleActionResult> {
  const projectKey = input.projectKey.trim();
  if (!projectKey) {
    return { success: false, error: "Project key is required." };
  }
  if (!input.inspectorId) {
    return { success: false, error: "Choose an inspector." };
  }
  if (!VALID_DAYS.has(input.scheduledDay)) {
    return { success: false, error: `"${input.scheduledDay}" is not a valid day.` };
  }

  const supabase = await createClient();

  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("id")
    .eq("project_key", projectKey)
    .maybeSingle();

  if (projectError) {
    return { success: false, error: projectError.message };
  }
  if (!project) {
    return {
      success: false,
      error: `No project with key "${projectKey}" -- check the PPAs tab, or import it first.`,
    };
  }

  const { error: insertError } = await supabase.from("inspector_schedules").insert({
    project_id: project.id,
    inspector_id: input.inspectorId,
    scheduled_day: input.scheduledDay,
    week_of: currentWeekMonday(),
    cluster: input.cluster?.trim() || null,
  });

  if (insertError) {
    if (insertError.code === "23505") {
      return { success: false, error: duplicateAssignmentMessage() };
    }
    return { success: false, error: insertError.message };
  }

  revalidateScheduleViews();
  return { success: true, message: `Added ${projectKey} to the schedule.` };
}

export interface ProjectSearchResult {
  projectKey: string;
  name: string;
  municipality: string | null;
  riskTier: string | null;
}

/**
 * Backs the schedule workspace's "Add visit" picker (see
 * add-visit-dialog.tsx) -- the replacement for the old raw
 * type-a-project-key input, which required the Manager to memorize keys
 * off the PPAs tab. Matches on project name OR municipality, riskiest
 * first (risk_probability desc, unscored last) since scheduling exists to
 * cover risk. Same manager-scoped RLS read as every other projects query.
 */
export async function searchProjects(
  query: string
): Promise<
  | { success: true; results: ProjectSearchResult[] }
  | { success: false; error: string }
> {
  // PostgREST's .or() syntax delimits conditions with commas/parens --
  // strip them from user input rather than attempting to escape.
  const q = query.trim().replace(/[,()]/g, " ").replace(/\s+/g, " ").trim();
  if (q.length < 2) {
    return { success: true, results: [] };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("projects")
    .select("project_key, name_of_project, municipality, risk_tier")
    .or(`name_of_project.ilike.%${q}%,municipality.ilike.%${q}%`)
    .order("risk_probability", { ascending: false, nullsFirst: false })
    .limit(20);

  if (error) {
    return { success: false, error: error.message };
  }

  return {
    success: true,
    results: (data ?? []).map((row) => ({
      projectKey: row.project_key,
      name: row.name_of_project,
      municipality: row.municipality,
      riskTier: row.risk_tier,
    })),
  };
}
