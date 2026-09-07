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
 *   3. The observed status is applied to `projects` (and, on the
 *      transition into completed, `date_of_completion`) — mirroring the
 *      real-world event that feature_engineering.py's Phase 6/7 proxy-date
 *      recovery logic was built to handle: a project transitioning from
 *      "ongoing, no completion date" to "resolved, has an outcome."
 *
 *      THIS STEP WAS BROKEN AND SILENT until it was rewritten around
 *      `applyProjectStatus` below — read that function's comment before
 *      touching this path. In short: the write ran as the inspector,
 *      `projects` has no inspector UPDATE policy, and an RLS-filtered
 *      UPDATE returns no error, so every field observation was discarded
 *      without a trace while the ML webhook still moved the risk tier.
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
 * and app/manager/ppas/[projectId]/page.tsx (re-signs and displays
 * them). Offline queuing for spotty field connectivity is still out of
 * scope for this scaffold and should be designed as its own follow-up piece
 * — flagging it here so it isn't mistaken for an oversight.
 */

import { revalidatePath } from "next/cache";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { todayLocalIsoDate } from "@/lib/local-date";
import { isMissingColumnError } from "@/lib/postgrest-errors";
import type { ProjectStatus } from "@/types/database";

export interface SubmitReportInput {
  projectId: string;
  statusObserved: ProjectStatus;
  percentComplete?: number;
  remarks?: string;
  photoUrls?: string[];
  /** When the visit actually happened, ISO. Defaults to now. Field work
   * is often written up the next morning, and `visited_at` feeds the
   * LSTM's monitoring-event sequence, so letting it default to the typing
   * time silently misdates the observation. */
  visitedAt?: string;
}

export type SubmitReportResult =
  | {
      success: true;
      /** What the report did to the project itself, so the Inspector can
       * be told rather than left guessing (this used to fail silently --
       * see applyProjectStatus below). */
      projectUpdated: boolean;
      previousStatus?: ProjectStatus;
      newStatus?: ProjectStatus;
    }
  | { success: false; error: string };

/**
 * May this user change `projects.status` for this project?
 *
 * Deliberately evaluated with the RLS-respecting client: a manager is
 * identified by their own `profiles` row (readable under "profiles: read
 * own"), and an inspector's assignment is read from
 * `inspector_schedules` under "schedules: inspectors read own" -- so the
 * check itself cannot see more than the caller legitimately can. Mirrors
 * the relation behind the "projects: inspectors read assigned" policy
 * (an inspector_schedules row linking this inspector to this project),
 * which is exactly the set of projects an inspector can be looking at
 * when they file a report.
 */
async function canWriteProjectStatus(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  projectId: string
): Promise<boolean> {
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .maybeSingle();

  if (profile?.role === "manager") return true;

  const { data: assignment } = await supabase
    .from("inspector_schedules")
    .select("id")
    .eq("inspector_id", userId)
    .eq("project_id", projectId)
    .limit(1)
    .maybeSingle();

  return Boolean(assignment);
}

/**
 * Applies a field observation to the project record.
 *
 * WHY THIS NEEDS THE SERVICE-ROLE CLIENT (the bug this replaces):
 * `projects` carries exactly two policies -- managers `FOR ALL`, and
 * inspectors `FOR SELECT` on their assigned projects. There is no
 * inspector UPDATE policy, so when this ran as the signed-in inspector
 * the UPDATE matched zero rows and PostgREST returned NO ERROR. The old
 * code awaited it without checking, so a project reported Completed in
 * the field silently stayed On-going on every Manager screen forever,
 * while the ML webhook (which patches risk_tier through the service
 * role) still moved the risk tier -- the two halves of the same event
 * disagreeing, with nothing surfaced anywhere. Verified against the live
 * database before this change: `rows affected: 0 | error: none`.
 *
 * The fix is NOT an RLS grant. Postgres policies gate rows, not columns,
 * so letting inspectors UPDATE `projects` would also let a field device
 * write `risk_tier`, `amount_php`, or `municipality`. Instead the table
 * stays manager-only and this one narrow write happens server-side,
 * behind `canWriteProjectStatus` -- the same shape as
 * actions/inspectors.ts's invite path, where the privileged action is
 * isolated in one audited place. `canWriteProjectStatus` IS the security
 * boundary here, since the service-role client bypasses RLS entirely.
 */
async function applyProjectStatus(
  projectId: string,
  statusObserved: ProjectStatus,
  previousCompletionDate: string | null
): Promise<{ ok: true } | { ok: false; error: string }> {
  const patch: { status: ProjectStatus; date_of_completion?: string } = {
    status: statusObserved,
  };

  // Set a completion date only on the transition INTO completed, and
  // never clear one that already exists: a later correction away from
  // "completed" records the new status without erasing the dated
  // evidence that the project was once observed finished. That date is
  // the loop's most valuable output -- it is what lets a project stop
  // depending on feature_engineering.py's proxy-date recovery.
  if (statusObserved === "completed" && !previousCompletionDate) {
    // Local calendar day, never toISOString(): see lib/local-date.ts. A
    // completion dated one day early propagates straight into T_actual
    // and therefore into the RedFlag target at the next retrain.
    patch.date_of_completion = todayLocalIsoDate();
  }

  const admin = createServiceRoleClient();
  const { data, error } = await admin
    .from("projects")
    .update(patch)
    .eq("id", projectId)
    .select("id");

  if (error) return { ok: false, error: error.message };
  if (!data || data.length === 0) {
    return { ok: false, error: "The project record could not be found." };
  }
  return { ok: true };
}

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
  /** Lets the ML service write the outcome back to this exact report's
   * `rescore_state`, so a dropped or failed re-score is visible and
   * retryable instead of vanishing. Null when the tracking migration
   * hasn't been applied. */
  reportId: string | null;
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
        report_id: payload.reportId,
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

  // Read the project's current state BEFORE writing anything: the
  // report's value to the pipeline is the transition it records, and the
  // completion-date rule below needs to know whether one already exists.
  // Readable here under "projects: inspectors read assigned".
  const { data: project } = await supabase
    .from("projects")
    .select("project_key, status, date_of_completion")
    .eq("id", input.projectId)
    .maybeSingle();

  if (!project) {
    return {
      success: false,
      error: "That project isn't assigned to you, so a report can't be filed against it.",
    };
  }

  const previousStatus = project.status;

  // A visit can be backdated but never postdated: a future observation is
  // either a typo or a claim about work not yet inspected, and it would
  // land in the model's event sequence as one.
  const now = new Date();
  const requested = input.visitedAt ? new Date(input.visitedAt) : now;
  const visitedAt = (
    Number.isNaN(requested.getTime()) || requested > now ? now : requested
  ).toISOString();

  const baseRow = {
    project_id: input.projectId,
    inspector_id: user.id,
    status_observed: input.statusObserved,
    percent_complete: input.percentComplete ?? null,
    remarks: input.remarks ?? null,
    photo_urls: input.photoUrls ?? null,
    visited_at: visitedAt,
  };

  // Try to record the re-score as pending. If
  // add_monitoring_reports_rescore_state.sql hasn't been run against this
  // database yet, PostgREST rejects the unknown column -- fall back to the
  // plain row rather than refusing to file a field report over a migration
  // the inspector has no control of. Filing must never be the thing that
  // breaks.
  let reportId: string | null = null;
  let insertError: { code?: string; message: string } | null = null;
  {
    const withState = await supabase
      .from("monitoring_reports")
      .insert({ ...baseRow, rescore_state: "pending" })
      .select("id")
      .single();

    if (withState.error && isMissingColumnError(withState.error)) {
      const plain = await supabase
        .from("monitoring_reports")
        .insert(baseRow)
        .select("id")
        .single();
      reportId = plain.data?.id ?? null;
      insertError = plain.error;
    } else {
      reportId = withState.data?.id ?? null;
      insertError = withState.error;
    }
  }

  if (insertError) {
    return { success: false, error: insertError.message };
  }

  // The report is now saved and must never be lost to a later failure --
  // everything below is a downstream consequence of a record that already
  // exists, so failures are reported back, not thrown.
  let projectUpdated = false;
  if (previousStatus !== input.statusObserved) {
    const allowed = await canWriteProjectStatus(supabase, user.id, input.projectId);
    if (allowed) {
      const applied = await applyProjectStatus(
        input.projectId,
        input.statusObserved,
        project.date_of_completion
      );
      if (applied.ok) {
        projectUpdated = true;
      } else {
        console.error("[submit-report] project status write failed:", applied.error);
      }
    } else {
      console.warn(
        "[submit-report] %s may not change status on project %s — report saved, project unchanged.",
        user.id,
        input.projectId
      );
    }
  }

  await notifyMlService({
    projectKey: project.project_key,
    statusObserved: input.statusObserved,
    percentComplete: input.percentComplete ?? null,
    amountSpent: null, // not yet collected by the inspector report form — see module docstring
    // The observation's own timestamp, not the submission's -- this is
    // what live_scoring anchors the new LSTM event and the elapsed-time
    // features to.
    observedAt: visitedAt,
    photoUrl: input.photoUrls?.[0] ?? null,
    reportId,
  });

  revalidatePath("/manager/ppas");
  revalidatePath(`/manager/ppas/${input.projectId}`);
  revalidatePath("/manager/reports");
  revalidatePath("/inspector");

  return {
    success: true,
    projectUpdated,
    previousStatus,
    newStatus: input.statusObserved,
  };
}
