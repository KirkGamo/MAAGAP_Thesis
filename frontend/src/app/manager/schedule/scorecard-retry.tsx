"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

/**
 * Retry for the optimizer scorecard's degraded state.
 *
 * The Schedule page has a good error boundary (error.tsx -> ErrorPanel) with a
 * "Try again" control, but it can never fire for this case:
 * `fetchOptimizerSummary` catches its own failure and returns null, which is
 * correct -- an unreachable solver must not take down a workspace that renders
 * fine from Supabase alone. The cost is that the one failure users actually
 * meet, routinely, was the one with no way to recover from it. The page said
 * "ML service not reachable" and left the manager with nothing to do but
 * navigate away and come back.
 *
 * `router.refresh()` is the right retry here rather than a client-side re-fetch:
 * the summary is read during the server render, so re-running that render is
 * what actually re-attempts it, and it refreshes the rest of the page's
 * server-fetched data in the same pass without discarding client state.
 */
export function ScorecardRetry() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  // Distinguishes "not tried yet" from "tried, still unreachable". Without it a
  // failed retry looks identical to no retry at all, and people press it again.
  const [attempted, setAttempted] = useState(false);

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        disabled={isPending}
        onClick={() => {
          setAttempted(true);
          startTransition(() => router.refresh());
        }}
        className="rounded-md border border-brand-navy/15 px-2 py-1 text-[11px] font-medium text-brand-navy transition-colors hover:bg-brand-surface focus-visible:ring-2 focus-visible:ring-brand-sky-dark focus-visible:ring-offset-1 focus-visible:outline-none disabled:opacity-60"
      >
        {isPending ? "Retrying…" : "Retry"}
      </button>
      {attempted && !isPending && (
        // Announced, because the visible change after a failed retry is
        // otherwise nothing at all.
        <span role="status" className="text-[11px] text-field-ink-faint">
          Still unreachable — the ML service may need starting.
        </span>
      )}
    </span>
  );
}
