"use server";

/**
 * MAAGAP — ML Feedback Loop: Inspector Report Submission
 * ================================================================================
 * This Server Action is the seam between the human field-monitoring workflow
 * (an Inspector physically visiting a project and filing a report) and the
 * ML pipeline in ml-service/ that MAAGAP's risk scoring depends on. It is a
 * placeholder in two senses, and both are intentional and documented rather
 * than silently deferred:
 *
 *   1. The Supabase write (inserting into `monitoring_reports`) is fully
 *      implemented and safe to use as-is — RLS (see
 *      supabase/schema.sql, "reports: inspectors insert own") independently
 *      enforces that an Inspector can only file a report as themselves.
 *
 *   2. The webhook call to the FastAPI ML service is NOT implemented against
 *      a real endpoint, because that endpoint does not exist yet in
 *      ml-service/ — this action documents exactly what it should do and
 *      calls a clearly-named, not-yet-built URL so wiring it up later is a
 *      one-file change, not an archaeology exercise.
 *
 * WHY THIS MATTERS FOR THE THESIS ARCHITECTURE
 * -----------------------------------------------
 * Every prior phase's ML work (preprocess.py -> feature_engineering.py ->
 * train_trees.py/train_lstm.py -> train_meta_learner.py ->
 * optimization_engine.py) runs against a static, offline snapshot of PPDO's
 * historical spreadsheet exports. That is correct for establishing an
 * honest baseline (see docs/MODEL_IMPROVEMENT_STRATEGY.md), but a
 * "production-ready system" per Chapter 3's architecture needs a live path
 * by which NEW field data — an Inspector's report that a project just
 * completed, or slipped further behind — eventually flows back into that
 * same pipeline. This action is that path's entry point on the frontend
 * side.
 *
 * INTENDED FULL FLOW (once the FastAPI endpoint exists)
 * -----------------------------------------------------
 *   1. Inspector submits a report via /inspector/report/[projectId] (this
 *      action's `submitReport` function).
 *   2. `monitoring_reports` row is written to Supabase (implemented below).
 *   3. If `statusObserved` indicates the project is now Completed/Functional
 *      (or its `percentComplete` reached 100), this action also updates
 *      `projects.status` and `projects.date_of_completion` — mirroring the
 *      real-world event that feature_engineering.py's Phase 6/7 proxy-date
 *      recovery logic was built to handle: a project transitioning from
 *      "ongoing, no completion date" to "resolved, has an outcome."
 *   4. A webhook POST fires to
 *      `${FASTAPI_ML_SERVICE_URL}/webhooks/monitoring-report`, authenticated
 *      via a shared secret (`ML_SERVICE_WEBHOOK_SECRET`) rather than being
 *      left open, carrying the project_key and the new status/completion
 *      date. The FastAPI service is responsible for deciding what to do
 *      with that signal — at minimum, marking the project's cached
 *      inference-time features stale; eventually, this is the trigger that
 *      would queue re-running preprocess.py/feature_engineering.py against
 *      a refreshed PPDO export and re-invoking train_meta_learner.py on a
 *      cadence (see docs/MODEL_IMPROVEMENT_STRATEGY.md Section 4's
 *      "Continuous Learning" recommendation — this webhook is the
 *      operational hook that recommendation assumed would exist).
 *   5. The webhook call is fire-and-forget from this action's perspective:
 *      its failure must never block the Inspector's report from being
 *      saved. A dropped webhook should be retried by the ML service side
 *      (e.g. via a dead-letter queue or a periodic reconciliation job that
 *      diffs Supabase against its own last-seen state), not by blocking a
 *      field worker's submit button on a network call to a second service.
 *
 * WHAT IS DELIBERATELY NOT HERE
 * ------------------------------
 * Photo upload handling (Supabase Storage), offline queuing for spotty
 * field connectivity, and the actual FastAPI route handler are all out of
 * scope for this scaffold and should be designed as their own follow-up
 * pieces — flagging them here so they aren't mistaken for oversights.
 */

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { ProjectStatus } from "@/types/database";

export interface SubmitReportInput {
  projectId: string;
  statusObserved: ProjectStatus;
  percentComplete?: number;
  remarks?: string;
  photoUrls?: string[];
}

export type SubmitReportResult =
  | { success: true }
  | { success: false; error: string };

/**
 * Notifies the FastAPI ML service that a project's real-world state may
 * have changed, so it can eventually trigger re-scoring/retraining.
 *
 * PLACEHOLDER: `${FASTAPI_ML_SERVICE_URL}/webhooks/monitoring-report` does
 * not exist in ml-service/ yet. Until it does, this function logs its
 * intent and returns without throwing — see the module docstring for the
 * full intended contract. Fire-and-forget: a failure here must never
 * surface as an error to the Inspector submitting the report.
 */
async function notifyMlService(payload: {
  projectKey: string;
  statusObserved: ProjectStatus;
  dateOfCompletion: string | null;
}) {
  const baseUrl = process.env.FASTAPI_ML_SERVICE_URL;
  const secret = process.env.ML_SERVICE_WEBHOOK_SECRET;

  if (!baseUrl) {
    console.warn(
      "[submit-report] FASTAPI_ML_SERVICE_URL is not configured — skipping ML " +
        "service webhook. This is expected until ml-service/ exposes " +
        "/webhooks/monitoring-report (see this file's module docstring)."
    );
    return;
  }

  try {
    await fetch(`${baseUrl}/webhooks/monitoring-report`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Webhook-Secret": secret ?? "",
      },
      body: JSON.stringify(payload),
      // Fire-and-forget: don't let a slow/unreachable ML service hold up
      // the Inspector's submission.
      signal: AbortSignal.timeout(3000),
    });
  } catch (err) {
    console.error("[submit-report] ML service webhook failed (non-fatal):", err);
  }
}

export async function submitReport(input: SubmitReportInput): Promise<SubmitReportResult> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { success: false, error: "Not signed in." };
  }

  const { error: insertError } = await supabase.from("monitoring_reports").insert({
    project_id: input.projectId,
    inspector_id: user.id,
    status_observed: input.statusObserved,
    percent_complete: input.percentComplete ?? null,
    remarks: input.remarks ?? null,
    photo_urls: input.photoUrls ?? null,
  });

  if (insertError) {
    return { success: false, error: insertError.message };
  }

  // If the field-observed status confirms completion, reflect that on the
  // project record itself — this is the live-data analogue of Phase 6/7's
  // offline proxy-completion-date recovery: a real, dated event (this
  // report) resolving a previously-ongoing project.
  let dateOfCompletion: string | null = null;
  if (input.statusObserved === "completed") {
    dateOfCompletion = new Date().toISOString().slice(0, 10);
    await supabase
      .from("projects")
      .update({ status: "completed", date_of_completion: dateOfCompletion })
      .eq("id", input.projectId);
  } else {
    await supabase.from("projects").update({ status: input.statusObserved }).eq("id", input.projectId);
  }

  const { data: project } = await supabase
    .from("projects")
    .select("project_key")
    .eq("id", input.projectId)
    .single();

  if (project) {
    await notifyMlService({
      projectKey: project.project_key,
      statusObserved: input.statusObserved,
      dateOfCompletion,
    });
  }

  revalidatePath("/manager/backlog");
  revalidatePath(`/manager/backlog/${input.projectId}`);
  revalidatePath("/inspector");

  return { success: true };
}
