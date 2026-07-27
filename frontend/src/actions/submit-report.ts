"use server";

/**
 * MAAGAP — ML Feedback Loop: Inspector Report Submission
 * ================================================================================
 * This Server Action is the seam between the human field-monitoring workflow
 * (an Inspector physically visiting a project and filing a report) and the
 * ML pipeline in ml-service/ that MAAGAP's risk scoring depends on.
 *
 *   1. The Supabase write (inserting into `monitoring_reports`) is fully
 *      implemented and safe to use as-is — RLS (see
 *      supabase/schema.sql, "reports: inspectors insert own") independently
 *      enforces that an Inspector can only file a report as themselves.
 *
 *   2. AS OF PHASE 8, the webhook call to the FastAPI ML service is wired to
 *      a real endpoint: `POST ${FASTAPI_ML_SERVICE_URL}/webhooks/monitoring-report`,
 *      implemented in ml-service/main.py (an alias of
 *      `/api/v1/update-monitoring`), which triggers
 *      ml-service/inference/live_scoring.py to refresh that one project's
 *      time-elapsed features and LSTM event sequence and re-run it through
 *      the already-trained RF/XGBoost/LSTM/meta-learner artifacts. See that
 *      module's docstring for exactly what this can and cannot do without a
 *      full retrain (new feature columns like percent_complete cannot move
 *      the score; status and elapsed-time features can).
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
 * AS OF PHASE 10, photo upload handling is implemented — see
 * app/inspector/report/[projectId]/report-form.tsx (captures/uploads to the
 * `monitoring-photos` Storage bucket, storing paths in `photoUrls` below)
 * and app/manager/backlog/[projectId]/page.tsx (re-signs and displays
 * them). Offline queuing for spotty field connectivity is still out of
 * scope for this scaffold and should be designed as its own follow-up piece
 * — flagging it here so it isn't mistaken for an oversight.
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
 * have changed, so it re-scores that project's live risk classification.
 *
 * WIRED (Phase 8 Task 2): `${FASTAPI_ML_SERVICE_URL}/webhooks/monitoring-report`
 * is now a real route — see ml-service/main.py's `monitoring_report_webhook`
 * (an alias of `POST /api/v1/update-monitoring`). The body is intentionally
 * snake_case to match FastAPI/Pydantic's `UpdateMonitoringPayload` field
 * names exactly, since FastAPI does not camelCase-alias by default. Still
 * fire-and-forget: a failure here must never surface as an error to the
 * Inspector submitting the report — ml-service/main.py's endpoint is only
 * ever a downstream consequence of a report that has already been saved to
 * Supabase (see submitReport() below), never a precondition for it.
 */
async function notifyMlService(payload: {
  projectKey: string;
  statusObserved: ProjectStatus;
  percentComplete: number | null;
  amountSpent: number | null;
  observedAt: string;
  photoUrl: string | null;
}) {
  const baseUrl = process.env.FASTAPI_ML_SERVICE_URL;
  const secret = process.env.ML_SERVICE_WEBHOOK_SECRET;

  if (!baseUrl) {
    console.warn(
      "[submit-report] FASTAPI_ML_SERVICE_URL is not configured — skipping ML " +
        "service webhook. Set it (e.g. http://localhost:8000 for local dev) to " +
        "enable live re-scoring via ml-service/main.py."
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
      body: JSON.stringify({
        project_key: payload.projectKey,
        status_observed: payload.statusObserved,
        percent_complete: payload.percentComplete,
        amount_spent: payload.amountSpent,
        observed_at: payload.observedAt,
        // Phase 10, Task 4: ml-service/main.py's UpdateMonitoringPayload
        // accepts one representative photo path for audit visibility on
        // that endpoint; the full set already lives in Supabase's
        // monitoring_reports.photo_urls (written above), which is the
        // record of truth.
        photo_url: payload.photoUrl,
      }),
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
      percentComplete: input.percentComplete ?? null,
      amountSpent: null, // not yet collected by the inspector report form — see module docstring
      observedAt: new Date().toISOString(),
      photoUrl: input.photoUrls?.[0] ?? null,
    });
  }

  revalidatePath("/manager/backlog");
  revalidatePath(`/manager/backlog/${input.projectId}`);
  revalidatePath("/inspector");

  return { success: true };
}
