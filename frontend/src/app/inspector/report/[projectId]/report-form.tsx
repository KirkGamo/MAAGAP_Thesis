"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { submitReport } from "@/actions/submit-report";
import type { ProjectStatus } from "@/types/database";

const STATUS_OPTIONS: { value: ProjectStatus; label: string }[] = [
  { value: "not_yet_implemented", label: "Not Yet Implemented" },
  { value: "for_bidding", label: "For Bidding" },
  { value: "on_going", label: "On-going" },
  { value: "completed", label: "Completed / Functional" },
];

/** Mobile-first: large tap targets, single column, minimal required
 * fields — an inspector is filling this out standing at a job site, not
 * at a desk. */
export function ReportForm({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [statusObserved, setStatusObserved] = useState<ProjectStatus>("on_going");
  const [percentComplete, setPercentComplete] = useState("");
  const [remarks, setRemarks] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await submitReport({
        projectId,
        statusObserved,
        percentComplete: percentComplete ? Number(percentComplete) : undefined,
        remarks: remarks || undefined,
      });
      if (res.success) {
        router.replace("/inspector");
        router.refresh();
      } else {
        setError(res.error);
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="status_observed">Status observed</Label>
        <select
          id="status_observed"
          className="h-12 rounded-md border border-slate-200 bg-white px-3 text-base"
          value={statusObserved}
          onChange={(e) => setStatusObserved(e.target.value as ProjectStatus)}
        >
          {STATUS_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="percent_complete">% complete (optional)</Label>
        <Input
          id="percent_complete"
          type="number"
          min="0"
          max="100"
          inputMode="numeric"
          className="h-12 text-base"
          value={percentComplete}
          onChange={(e) => setPercentComplete(e.target.value)}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="remarks">Remarks</Label>
        <textarea
          id="remarks"
          rows={4}
          className="rounded-md border border-slate-200 bg-white px-3 py-2 text-base"
          placeholder="Anything the office should know about this visit..."
          value={remarks}
          onChange={(e) => setRemarks(e.target.value)}
        />
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <Button type="submit" size="lg" disabled={isPending} className="w-full">
        {isPending ? "Submitting..." : "Submit report"}
      </Button>
    </form>
  );
}
