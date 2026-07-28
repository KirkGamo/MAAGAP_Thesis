"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { deployLatestSchedule } from "@/actions/deploy-schedule";

/**
 * Phase 12.1 fix: deployLatestSchedule() used to be an unimplemented
 * placeholder that always returned `{ success: false }`, and this button
 * discarded that result entirely -- so clicking it did nothing visible,
 * with no error surfaced anywhere. Now that the action does real work
 * (see actions/deploy-schedule.ts), its result is shown inline instead of
 * thrown away.
 */
export function DeployScheduleButton() {
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<
    { success: true; message: string } | { success: false; error: string } | null
  >(null);

  function handleClick() {
    setResult(null);
    startTransition(async () => {
      const res = await deployLatestSchedule();
      setResult(res);
    });
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <Button variant="outline" disabled={isPending} onClick={handleClick}>
        {isPending ? "Deploying..." : "Deploy latest schedule"}
      </Button>
      {result && (
        <p
          className={`max-w-xs text-right text-xs ${
            result.success ? "text-emerald-700" : "text-red-600"
          }`}
        >
          {result.success ? result.message : result.error}
        </p>
      )}
    </div>
  );
}
