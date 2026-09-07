"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { Badge, statusVariant } from "@/components/ui/badge";

export interface ReportListItem {
  id: string;
  visitedAt: string;
  inspectorName: string;
  projectName: string;
  municipality: string | null;
  statusObserved: string;
  statusLabel: string;
  photoCount: number;
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
}: {
  reports: ReportListItem[];
  selectedId: string | null;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function select(id: string) {
    const next = new URLSearchParams(searchParams.toString());
    next.set("report", id);
    router.push(`/manager/reports?${next.toString()}`, { scroll: false });
  }

  if (reports.length === 0) {
    return (
      <p className="p-4 text-center text-sm text-slate-400">
        No monitoring reports match this filter.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-1">
      {reports.map((report) => (
        <li key={report.id}>
          <button
            type="button"
            onClick={() => select(report.id)}
            className={cn(
              "w-full rounded-md border px-2.5 py-2 text-left transition-colors",
              report.id === selectedId
                ? "border-brand-navy/20 bg-brand-surface"
                : "border-transparent hover:bg-brand-surface/60"
            )}
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate text-sm font-medium text-slate-800">
                {report.projectName}
              </span>
              <span className="shrink-0 text-[11px] tabular-nums text-slate-400">
                {new Date(report.visitedAt).toLocaleDateString()}
              </span>
            </div>
            <div className="mt-1 flex items-center justify-between gap-2">
              <span className="truncate text-[11px] text-slate-500">
                {report.inspectorName}
                {report.municipality ? ` · ${report.municipality}` : ""}
              </span>
              <span className="flex shrink-0 items-center gap-1.5">
                {report.photoCount > 0 && (
                  <span className="text-[10px] text-slate-400">{report.photoCount} photo</span>
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
