import type { ReportListItem } from "../report-list";

/**
 * Ordering for the Reports audit trail.
 *
 * Extracted from page.tsx so it can be tested. The option that matters --
 * "awaiting re-score first" -- cannot be exercised against the live data,
 * where every report has settled to `done` and the page headline reads "0
 * awaiting re-score". That is the healthy state and the one the system is in
 * almost all the time, which is exactly why the unhealthy ordering needs
 * pinning somewhere other than the screen.
 */
export type ReportSort = "newest" | "oldest" | "rescore";

export function parseReportSort(raw: string | undefined): ReportSort {
  return raw === "oldest" || raw === "rescore" ? raw : "newest";
}

/**
 * Lower sorts first. `failed` outranks `pending` because the two need
 * different actions: a failed re-score has already been attempted and needs
 * someone to intervene, while a pending one may still resolve on its own.
 *
 * A null state means the rescore-tracking migration has not been applied, so
 * nothing is known about this report's re-score. It is ranked with `done`
 * rather than with the problems: on an instance without the migration every
 * report would otherwise be flagged as needing attention, which is noise, not
 * information.
 */
const RESCORE_URGENCY: Record<string, number> = { failed: 0, pending: 1, done: 2 };

function urgency(state: string | null): number {
  return RESCORE_URGENCY[state ?? "done"] ?? 2;
}

/** Returns a new array; never mutates the input. */
export function sortReports(reports: ReportListItem[], sort: ReportSort): ReportListItem[] {
  const out = [...reports];
  if (sort === "oldest") {
    return out.sort((a, b) => a.visitedAt.localeCompare(b.visitedAt));
  }
  if (sort === "rescore") {
    return out.sort((a, b) => {
      const ua = urgency(a.rescoreState);
      const ub = urgency(b.rescoreState);
      // Date breaks the tie, so the order stays meaningful once everything has
      // settled and the primary key is uniform across the whole list.
      return ua !== ub ? ua - ub : b.visitedAt.localeCompare(a.visitedAt);
    });
  }
  return out.sort((a, b) => b.visitedAt.localeCompare(a.visitedAt));
}
