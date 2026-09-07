"use server";

/**
 * MAAGAP — re-score retry (reporting loop, phase 3).
 *
 * The report webhook is fire-and-forget with a short timeout, so a report
 * filed while the ML service was unreachable is saved with its risk score
 * never refreshed. Before this existed there was no way to notice that,
 * let alone fix it: actions/submit-report.ts's own docstring assumed "a
 * dead-letter queue or a periodic reconciliation job" on the service side
 * that was never built. This is the manual version of it — a Manager
 * clicking Retry on a stuck report from the Reports tab.
 *
 * Manager-only in effect: the read below goes through the RLS client, and
 * "reports: managers read all" / "reports: inspectors read own" mean an
 * inspector could only ever retry their own report, which is harmless.
 */

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isMissingColumnError } from "@/lib/postgrest-errors";

export type RetryRescoreResult =
  | { success: true; message: string }
  | { success: false; error: string };

export async function retryRescore(reportId: string): Promise<RetryRescoreResult> {
  const baseUrl = process.env.FASTAPI_ML_SERVICE_URL;
  if (!baseUrl) {
    return {
      success: false,
      error: "FASTAPI_ML_SERVICE_URL is not configured, so there is no ML service to retry against.",
    };
  }

  const supabase = await createClient();

  const { data: report, error } = await supabase
    .from("monitoring_reports")
    .select(
      "id, status_observed, percent_complete, visited_at, photo_urls, project:projects(project_key)"
    )
    .eq("id", reportId)
    .maybeSingle();

  if (error) return { success: false, error: error.message };
  if (!report) return { success: false, error: "That report no longer exists." };

  const project = report.project as unknown as { project_key: string } | null;
  if (!project) {
    return { success: false, error: "That report's project could not be resolved." };
  }

  // Mark it in flight first, so a retry that hangs still reads as pending
  // rather than staying stuck on its previous 'failed'.
  const { error: stateError } = await supabase
    .from("monitoring_reports")
    .update({ rescore_state: "pending", rescore_error: null })
    .eq("id", reportId);

  if (stateError && !isMissingColumnError(stateError)) {
    return { success: false, error: stateError.message };
  }
  const trackingEnabled = !stateError;

  try {
    const res = await fetch(`${baseUrl}/webhooks/monitoring-report`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Webhook-Secret": process.env.ML_SERVICE_WEBHOOK_SECRET ?? "",
      },
      body: JSON.stringify({
        project_key: project.project_key,
        status_observed: report.status_observed,
        percent_complete: report.percent_complete,
        amount_spent: null,
        observed_at: report.visited_at,
        photo_url: report.photo_urls?.[0] ?? null,
        report_id: trackingEnabled ? report.id : null,
      }),
      // Longer than the submit path's 3s: a Manager clicking Retry is
      // waiting on this deliberately, unlike an inspector mid-submit.
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      return { success: false, error: `The ML service returned ${res.status}.` };
    }
  } catch (err) {
    return {
      success: false,
      error: `Could not reach the ML service: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  revalidatePath("/manager/reports");

  return {
    success: true,
    message: trackingEnabled
      ? "Re-score requested — the outcome lands on this report shortly."
      : "Re-score requested. Outcome tracking needs add_monitoring_reports_rescore_state.sql to be run.",
  };
}
