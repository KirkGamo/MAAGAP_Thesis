"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { getOptimizerStatus, startOptimizerRun } from "@/actions/run-optimizer";

const POLL_INTERVAL_MS = 5000;

/**
 * The in-app replacement for "open a terminal and run
 * optimization_engine.py". Kicks off a background run on the ML service
 * (see actions/run-optimizer.ts) and polls its status until it lands;
 * the page refresh then re-reads the scorecard/latest-schedule so the
 * new solve is immediately deployable. `initiallyRunning` lets a Manager
 * who navigated away mid-run resume seeing progress when they come back.
 */
export function RunOptimizerButton({
  initiallyRunning,
  freshnessLabel,
}: {
  initiallyRunning: boolean;
  /** Server-computed "Last optimized …" line (null when unknown). */
  freshnessLabel: string | null;
}) {
  const router = useRouter();
  const [isStarting, startTransition] = useTransition();
  const [running, setRunning] = useState(initiallyRunning);
  const [result, setResult] = useState<
    { kind: "ok" | "error"; message: string } | null
  >(null);

  useEffect(() => {
    if (!running) return;
    const handle = setInterval(async () => {
      const status = await getOptimizerStatus();
      if (!status) return; // service unreachable this tick -- keep waiting
      if (status.state === "done") {
        setRunning(false);
        setResult({ kind: "ok", message: "Optimizer finished — deploy to publish the new schedule." });
        router.refresh();
      } else if (status.state === "failed") {
        setRunning(false);
        setResult({
          kind: "error",
          message: `Optimizer run failed: ${status.error ?? "unknown error"}`,
        });
      }
    }, POLL_INTERVAL_MS);
    return () => clearInterval(handle);
  }, [running, router]);

  function handleClick() {
    setResult(null);
    startTransition(async () => {
      const res = await startOptimizerRun();
      if (res.success) {
        setRunning(true);
      } else {
        setResult({ kind: "error", message: res.error });
      }
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button variant="outline" disabled={isStarting || running} onClick={handleClick}>
        {running ? "Optimizing…" : isStarting ? "Starting…" : "Run optimizer"}
      </Button>
      {result ? (
        <p
          className={`max-w-56 text-right text-[11px] ${
            result.kind === "ok" ? "text-emerald-700" : "text-red-600"
          }`}
        >
          {result.message}
        </p>
      ) : running ? (
        <p className="text-[11px] text-slate-400">Scoring projects, then solving…</p>
      ) : freshnessLabel ? (
        <p className="text-[11px] text-slate-400">{freshnessLabel}</p>
      ) : null}
    </div>
  );
}
