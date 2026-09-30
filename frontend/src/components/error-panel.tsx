"use client";

import { Card } from "@/components/tremor/card";
import { Button } from "@/components/ui/button";

/**
 * F1: the shared body of every error boundary.
 *
 * MAAGAP is two separately deployed services. The Next.js app can be perfectly
 * healthy while the FastAPI ML service is restarting, redeploying, or simply
 * unreachable — so "a dependency is down" is a state users will genuinely meet,
 * not a theoretical one. Before this, any such error surfaced the framework's
 * default error page: a stack trace in development, an unexplained blank in
 * production, and in neither case any indication of what still worked.
 *
 * Three things every boundary here does:
 *
 *   1. Says which dependency failed, in the user's terms, not the exception's.
 *   2. Says what still works, so a manager knows whether to wait or work around
 *      it. A down ML service does not stop them reading the portfolio.
 *   3. Offers a retry, because most of these failures are transient.
 *
 * The digest is shown because Next.js redacts server error messages in
 * production and replaces them with that id — without it, a user reporting a
 * problem has nothing to quote and the server log cannot be found.
 */
export function ErrorPanel({
  title,
  whatFailed,
  stillWorks,
  error,
  reset,
}: {
  title: string;
  whatFailed: string;
  stillWorks?: string;
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-brand-navy">{title}</h1>
        <p className="text-sm text-slate-500">{whatFailed}</p>
      </div>

      <Card>
        <div className="flex flex-col gap-4">
          {stillWorks ? (
            <p className="text-sm text-slate-600">
              <span className="font-medium text-brand-navy">Still available: </span>
              {stillWorks}
            </p>
          ) : null}

          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={reset}>Try again</Button>
            <span className="text-xs text-slate-400">
              Most of these clear on their own — the services restart independently.
            </span>
          </div>

          {error.digest ? (
            <p className="text-xs text-slate-400">
              Reference <code className="font-mono">{error.digest}</code> — quote this if you
              report the problem, so the matching server log can be found.
            </p>
          ) : null}

          {process.env.NODE_ENV !== "production" && error.message ? (
            <pre className="overflow-x-auto rounded-md bg-slate-50 p-3 text-xs text-slate-600">
              {error.message}
            </pre>
          ) : null}
        </div>
      </Card>
    </div>
  );
}
