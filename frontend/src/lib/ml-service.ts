/**
 * Server-side client for the FastAPI ML service.
 *
 * WHY THIS EXISTS. The service's read endpoints used to be unauthenticated, so
 * callers fetched them with a bare `fetch(url)`. When S2 closed that hole --
 * /api/v1/latest-schedule returns which inspector is at which project on which
 * day, and /api/v1/live-score exposes any project's risk tier -- three frontend
 * call sites silently started receiving 401:
 *
 *     manager/models/page.tsx     -> /api/v1/model-metrics
 *     actions/deploy-schedule.ts  -> /api/v1/latest-schedule
 *     actions/run-optimizer.ts    -> /api/v1/optimizer-status
 *
 * Nothing caught it. The Python tests assert the service rejects unauthenticated
 * callers, which it correctly does, and the frontend tests do not cross the
 * network. The failure only appears when both halves run together.
 *
 * Centralising the call means the header is attached once. A new endpoint
 * cannot be consumed without it by forgetting, because there is no longer a
 * plausible path that omits it.
 *
 * SERVER ONLY. ML_SERVICE_WEBHOOK_SECRET is not NEXT_PUBLIC_-prefixed and must
 * never become so: shipping it to the browser would hand every visitor the
 * ability to mutate risk tiers and start optimizer runs.
 */

export class MlServiceNotConfiguredError extends Error {
  constructor() {
    super(
      "FASTAPI_ML_SERVICE_URL is not configured — set it in frontend/.env.local " +
        "(e.g. http://localhost:8000 for local dev) so this action can reach the ML service."
    );
    this.name = "MlServiceNotConfiguredError";
  }
}

/** The configured base URL, or null when the service is not wired up. */
export function mlServiceBaseUrl(): string | null {
  return process.env.FASTAPI_ML_SERVICE_URL || null;
}

/**
 * `fetch` against the ML service with the shared secret attached.
 *
 * `path` is the route including its leading slash. Caller-supplied headers are
 * merged, but the secret is applied last so it cannot be accidentally
 * overwritten by a caller passing its own `headers` object.
 */
export async function mlServiceFetch(
  path: string,
  init: RequestInit = {}
): Promise<Response> {
  const baseUrl = mlServiceBaseUrl();
  if (!baseUrl) throw new MlServiceNotConfiguredError();

  const secret = process.env.ML_SERVICE_WEBHOOK_SECRET;
  const headers = new Headers(init.headers);
  if (secret) headers.set("X-Webhook-Secret", secret);

  return fetch(`${baseUrl}${path}`, {
    cache: "no-store",
    ...init,
    headers,
  });
}
