"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  deployLatestSchedule,
  previewDeploy,
  type DeployPreview,
} from "@/actions/deploy-schedule";

/**
 * Two-step deploy (schedule workspace phase 4): the deploy action
 * replaces the ENTIRE current week -- including any manual edits made
 * through the agenda popovers/Add visit -- so when the week already has
 * assignments, clicking first fetches a preview (previewDeploy) and asks
 * for confirmation, stating exactly how many rows will be replaced and
 * how many of them differ from the optimizer's output (the proxy for
 * manual edits). An empty week deploys immediately -- there is nothing
 * to protect.
 */
export function DeployScheduleButton() {
  const [isPending, startTransition] = useTransition();
  const [pendingPreview, setPendingPreview] = useState<DeployPreview | null>(null);
  const [result, setResult] = useState<
    { success: true; message: string } | { success: false; error: string } | null
  >(null);

  function runDeploy() {
    setPendingPreview(null);
    startTransition(async () => {
      const res = await deployLatestSchedule();
      setResult(res);
    });
  }

  function handleClick() {
    setResult(null);
    startTransition(async () => {
      const res = await previewDeploy();
      if (!res.success) {
        setResult(res);
        return;
      }
      // Confirm whenever the deploy would destroy something (an existing
      // week) OR would land less than the optimizer produced -- a solve
      // that maps to a handful of rows because inspector slots are
      // unassigned is exactly the case a Manager must see BEFORE the
      // replace, not in the receipt afterwards.
      const skipped =
        res.preview.skippedUnmappedInspector + res.preview.skippedUnknownProject;
      if (res.preview.existing === 0 && skipped === 0) {
        const deployed = await deployLatestSchedule();
        setResult(deployed);
      } else {
        setPendingPreview(res.preview);
      }
    });
  }

  const skippedParts: string[] = [];
  if (pendingPreview && pendingPreview.skippedUnmappedInspector > 0) {
    skippedParts.push(
      `${pendingPreview.skippedUnmappedInspector} have no inspector assigned to their "Inspector_N" slot (fix on the Inspectors tab)`
    );
  }
  if (pendingPreview && pendingPreview.skippedUnknownProject > 0) {
    skippedParts.push(
      `${pendingPreview.skippedUnknownProject} reference a project that isn't imported yet`
    );
  }

  const incomingCaption = pendingPreview
    ? `Deploys ${pendingPreview.incoming} of ${pendingPreview.totalRows} optimizer row(s).` +
      (skippedParts.length > 0 ? ` Skipping: ${skippedParts.join("; ")}.` : "")
    : null;

  const replaceCaption =
    pendingPreview && pendingPreview.existing > 0
      ? `Replaces all ${pendingPreview.existing} current assignment(s)` +
        (pendingPreview.differing > 0
          ? ` — ${pendingPreview.differing} differ from the optimizer output (likely manual edits) and will be lost.`
          : ".")
      : null;

  return (
    <div className="flex flex-col items-end gap-1.5">
      {pendingPreview ? (
        <div className="flex max-w-sm flex-col items-end gap-1.5 rounded-md border border-orange-200 bg-orange-50 p-2">
          <p className="text-right text-[11px] text-orange-700">{incomingCaption}</p>
          {replaceCaption && (
            <p className="text-right text-[11px] font-medium text-orange-800">{replaceCaption}</p>
          )}
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={isPending} onClick={runDeploy}>
              {isPending ? "Deploying…" : "Replace schedule"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={isPending}
              onClick={() => setPendingPreview(null)}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button variant="outline" disabled={isPending} onClick={handleClick}>
          {isPending ? "Checking…" : "Deploy latest schedule"}
        </Button>
      )}
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
