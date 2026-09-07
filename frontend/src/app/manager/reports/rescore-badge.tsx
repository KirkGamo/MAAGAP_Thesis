"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { retryRescore } from "@/actions/retry-rescore";
import type { RescoreState } from "@/types/database";

const TONE: Record<RescoreState, string> = {
  done: "border-emerald-200 bg-emerald-50 text-emerald-700",
  pending: "border-amber-200 bg-amber-50 text-amber-700",
  failed: "border-red-200 bg-red-50 text-red-700",
  skipped: "border-slate-200 bg-slate-50 text-slate-500",
};

const LABEL: Record<RescoreState, string> = {
  done: "Re-scored",
  pending: "Awaiting re-score",
  failed: "Re-score failed",
  skipped: "Not re-scored",
};

/** Compact state pill for the report list. */
export function RescoreChip({ state }: { state: RescoreState }) {
  return (
    <span className={`rounded border px-1.5 py-0.5 text-[10px] ${TONE[state]}`}>
      {LABEL[state]}
    </span>
  );
}

/**
 * The detail pane's re-score panel: what happened to this report's ML
 * re-score, and a Retry for the states worth retrying. "Skipped" is not
 * one of them -- the ML service reports it when the project has no
 * trained representation to score, so retrying repeats the same nothing.
 */
export function RescorePanel({
  reportId,
  state,
  rescoredAt,
  error,
}: {
  reportId: string;
  state: RescoreState;
  rescoredAt: string | null;
  error: string | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const retryable = state === "failed" || state === "pending";

  function handleRetry() {
    setResult(null);
    startTransition(async () => {
      const res = await retryRescore(reportId);
      setResult({ ok: res.success, message: res.success ? res.message : res.error });
      if (res.success) router.refresh();
    });
  }

  return (
    <div className="rounded-md border border-brand-navy/10 p-2">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5">
          <RescoreChip state={state} />
          {rescoredAt && (
            <span className="text-[11px] text-slate-400">
              {new Date(rescoredAt).toLocaleString()}
            </span>
          )}
        </span>
        {retryable && (
          <Button
            size="sm"
            variant="outline"
            className="h-6 px-2 text-[11px]"
            disabled={isPending}
            onClick={handleRetry}
          >
            {isPending ? "Retrying…" : "Retry re-score"}
          </Button>
        )}
      </div>
      {error && <p className="mt-1.5 text-[11px] leading-relaxed text-slate-500">{error}</p>}
      {result && (
        <p
          className={`mt-1.5 text-[11px] leading-relaxed ${
            result.ok ? "text-emerald-700" : "text-red-600"
          }`}
        >
          {result.message}
        </p>
      )}
    </div>
  );
}
