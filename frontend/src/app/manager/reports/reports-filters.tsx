"use client";

import { Input } from "@/components/ui/input";
import { useUrlState } from "@/lib/use-url-state";
import { cn } from "@/lib/utils";

interface ReportsFiltersProps {
  inspectors: { id: string; full_name: string | null }[];
}

/** URL-search-param-driven filters for the Reports audit trail, same
 * pattern as PpaFilters/DayFilter -- shareable/bookmarkable, no
 * client-side data-fetching library needed. */
export function ReportsFilters({ inspectors }: ReportsFiltersProps) {
  const { isPending, setParam, searchParams } = useUrlState("/manager/reports");

  return (
    // shrink-0 + fixed widths: as a flex item in the page header this
    // block was being squeezed and wrapping onto a second line, which
    // costs vertical space the pinned layout doesn't have.
    <div className={cn("flex shrink-0 items-center gap-2 transition-opacity", isPending && "opacity-60")}>
      <Input
        placeholder="Search by project name..."
        defaultValue={searchParams.get("q") ?? ""}
        onChange={(e) => setParam("q", e.target.value)}
        className="h-9 w-56"
      />
      <select
        className="h-9 rounded-md border border-brand-navy/10 bg-white px-3 text-sm"
        defaultValue={searchParams.get("inspector") ?? ""}
        onChange={(e) => setParam("inspector", e.target.value)}
      >
        <option value="">All inspectors</option>
        {inspectors.map((inspector) => (
          <option key={inspector.id} value={inspector.id}>
            {inspector.full_name ?? "Unnamed"}
          </option>
        ))}
      </select>
      {/* This list only grows: every field visit adds a row permanently,
          unlike the roster or a week's schedule, which are bounded. "Awaiting
          re-score" is the reason this control exists -- a report whose rescore
          never landed is the one thing here that needs acting on, and sorted
          by date it sinks out of sight as the trail lengthens. */}
      <label className="sr-only" htmlFor="reports-sort">
        Sort reports
      </label>
      <select
        id="reports-sort"
        className="h-9 rounded-md border border-brand-navy/10 bg-white px-3 text-sm"
        defaultValue={searchParams.get("sort") ?? ""}
        onChange={(e) => setParam("sort", e.target.value)}
      >
        <option value="">Newest first</option>
        <option value="oldest">Oldest first</option>
        <option value="rescore">Awaiting re-score first</option>
      </select>
    </div>
  );
}
