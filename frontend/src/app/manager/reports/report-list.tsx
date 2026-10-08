"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { useUrlState } from "@/lib/use-url-state";
import { Badge, statusVariant } from "@/components/ui/badge";
import { RescoreChip } from "./rescore-badge";
import type { RescoreState } from "@/types/database";
import { ClipboardList, SearchX } from "lucide-react";
import { EmptyState } from "@/components/empty-state";

export interface ReportListItem {
  id: string;
  visitedAt: string;
  inspectorName: string;
  projectName: string;
  municipality: string | null;
  statusObserved: string;
  statusLabel: string;
  photoCount: number;
  /** Null when the re-score tracking migration hasn't been applied. */
  rescoreState: RescoreState | null;
}

/**
 * The master half of the Reports workspace. One line per report --
 * selecting it loads the detail pane beside it, which is what lets this
 * tab drop the old seven-column table that could not fit remarks and a
 * photo strip without scrolling sideways.
 *
 * Selection travels in the URL (`?report=`) rather than local state, so
 * a particular report stays linkable and survives a refresh, matching
 * how every other filter in this portal works.
 */
export function ReportList({
  reports,
  selectedId,
  filtered,
}: {
  reports: ReportListItem[];
  selectedId: string | null;
  /** Whether a search or inspector filter is currently narrowing the list. */
  filtered: boolean;
}) {
  const router = useRouter();
  const { isPending, setParam } = useUrlState("/manager/reports");
  // Selecting a report re-renders the detail pane from the server and signs its
  // photo URLs -- measured at 897ms. The row now shows as selected immediately.
  const [requested, setRequested] = useState<string | null>(null);

  function select(id: string) {
    setRequested(id);
    setParam("report", id, { scroll: false });
  }

  // Two different situations were showing the same sentence, and only one of
  // them is a dead end the reader can act on. "No reports match this filter"
  // is wrong and faintly alarming on a system where nobody has filed anything
  // yet -- it implies reports exist and are being hidden.
  if (reports.length === 0) {
    return filtered ? (
      <EmptyState
        icon={SearchX}
        title="No reports match these filters"
        hint="Try widening the search, or clear the filters to see every report."
        action={
          <button
            type="button"
            onClick={() => router.push("/manager/reports")}
            className="rounded-md border border-brand-navy/15 px-2.5 py-1 text-xs font-medium text-brand-navy transition-colors hover:bg-brand-surface focus-visible:ring-2 focus-visible:ring-brand-sky-dark focus-visible:ring-offset-1 focus-visible:outline-none"
          >
            Clear filters
          </button>
        }
      />
    ) : (
      <EmptyState
        icon={ClipboardList}
        title="No monitoring reports yet"
        hint="Reports appear here once an inspector files one from the field. Assign visits on the Schedule tab and deploy the week to put inspectors on site."
      />
    );
  }

  return (
    <ul className="flex flex-col gap-1">
      {reports.map((report) => (
        <li key={report.id}>
          <button
            type="button"
            onClick={() => select(report.id)}
            aria-current={report.id === selectedId ? "true" : undefined}
            aria-busy={isPending && requested === report.id ? true : undefined}
            className={cn(
              "w-full rounded-md border px-2.5 py-2 text-left transition-colors",
              report.id === selectedId || (isPending && requested === report.id)
                ? "border-brand-navy/20 bg-brand-surface"
                : "border-transparent hover:bg-brand-surface/60",
              isPending && requested === report.id && "animate-pulse"
            )}
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate text-sm font-medium text-slate-800">
                {report.projectName}
              </span>
              <span className="shrink-0 text-[11px] tabular-nums text-ink-faint">
                {new Date(report.visitedAt).toLocaleDateString()}
              </span>
            </div>
            <div className="mt-1 flex items-center justify-between gap-2">
              <span className="truncate text-[11px] text-ink-muted">
                {report.inspectorName}
                {report.municipality ? ` · ${report.municipality}` : ""}
              </span>
              <span className="flex shrink-0 items-center gap-1.5">
                {report.rescoreState && report.rescoreState !== "done" && (
                  <RescoreChip state={report.rescoreState} />
                )}
                {report.photoCount > 0 && (
                  <span className="text-[10px] text-ink-faint">{report.photoCount} photo</span>
                )}
                <Badge
                  variant={statusVariant(report.statusObserved)}
                  className="px-1.5 py-0 text-[10px]"
                >
                  {report.statusLabel}
                </Badge>
              </span>
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}
