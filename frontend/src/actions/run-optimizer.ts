"use server";

/**
 * Schedule workspace phase 3: start and observe optimizer runs on the ML
 * service (POST /api/v1/run-optimizer + GET /api/v1/optimizer-status --
 * see ml-service/main.py). Server actions so the webhook secret stays
 * server-side; the client button (run-optimizer-button.tsx) calls these
 * and never sees the secret. Both degrade to plain error/null results
 * when the ML service is unreachable -- the workspace renders fine
 * without it (see page.tsx's fetchOptimizerSummary for the same stance).
 */

export interface OptimizerRunStatus {
  state: "idle" | "running" | "done" | "failed";
  started_at?: string | null;
  finished_at?: string | null;
  error?: string | null;
  /** mtime of the schedule CSV on disk, however it was produced. */
  schedule_generated_at?: string | null;
}

export async function startOptimizerRun(): Promise<
  { success: true; message: string } | { success: false; error: string }
> {
  const baseUrl = process.env.FASTAPI_ML_SERVICE_URL;
  if (!baseUrl) {
    return {
      success: false,
      error:
        "FASTAPI_ML_SERVICE_URL is not configured -- set it in frontend/.env.local so this action can reach the ML service.",
    };
  }

  const headers: Record<string, string> = {};
  const secret = process.env.ML_SERVICE_WEBHOOK_SECRET;
  if (secret) headers["X-Webhook-Secret"] = secret;

  try {
    const res = await fetch(`${baseUrl}/api/v1/run-optimizer`, {
      method: "POST",
      headers,
      cache: "no-store",
    });
    if (res.status === 401) {
      return {
        success: false,
        error:
          "The ML service rejected the webhook secret -- check ML_SERVICE_WEBHOOK_SECRET in frontend/.env.local matches the service's.",
      };
    }
    if (res.status === 409) {
      return { success: false, error: "An optimizer run is already in progress." };
    }
    if (!res.ok) {
      return { success: false, error: `ML service returned ${res.status}.` };
    }
    return {
      success: true,
      message: "Optimizer run started — this takes a few minutes (scoring, then solving).",
    };
  } catch (err) {
    return {
      success: false,
      error: `Could not reach the ML service at ${baseUrl}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    };
  }
}

export async function getOptimizerStatus(): Promise<OptimizerRunStatus | null> {
  const baseUrl = process.env.FASTAPI_ML_SERVICE_URL;
  if (!baseUrl) return null;
  try {
    const res = await fetch(`${baseUrl}/api/v1/optimizer-status`, {
      cache: "no-store",
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return null;
    return (await res.json()) as OptimizerRunStatus;
  } catch {
    return null;
  }
}
