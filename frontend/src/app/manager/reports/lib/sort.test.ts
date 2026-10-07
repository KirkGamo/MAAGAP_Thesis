import { describe, expect, it } from "vitest";
import { parseReportSort, sortReports } from "./sort";
import type { ReportListItem } from "../report-list";
import type { RescoreState } from "@/types/database";

/**
 * The "awaiting re-score first" ordering is the reason the sort control exists,
 * and it is the one thing on this page that cannot be checked by looking at it:
 * every live report has settled to `done`, so the screen shows the healthy case
 * no matter whether the unhealthy ordering is right.
 */

function report(
  id: string,
  visitedAt: string,
  rescoreState: RescoreState | null = "done"
): ReportListItem {
  return {
    id,
    visitedAt,
    inspectorName: "Test Inspector",
    projectName: `Project ${id}`,
    municipality: null,
    statusObserved: "on_going",
    statusLabel: "On-going",
    photoCount: 0,
    rescoreState,
  };
}

const ids = (rows: ReportListItem[]) => rows.map((r) => r.id);

describe("parseReportSort", () => {
  it("defaults to newest for anything unrecognised", () => {
    for (const raw of [undefined, "", "bogus", "NEWEST", "date"]) {
      expect(parseReportSort(raw)).toBe("newest");
    }
  });

  it("accepts the two non-default orderings", () => {
    expect(parseReportSort("oldest")).toBe("oldest");
    expect(parseReportSort("rescore")).toBe("rescore");
  });
});

describe("sortReports", () => {
  const a = report("a", "2026-10-04T00:00:00Z");
  const b = report("b", "2026-09-08T00:00:00Z");
  const c = report("c", "2026-10-01T00:00:00Z");

  it("puts the most recent first by default", () => {
    expect(ids(sortReports([b, c, a], "newest"))).toEqual(["a", "c", "b"]);
  });

  it("reverses for oldest", () => {
    expect(ids(sortReports([a, c, b], "oldest"))).toEqual(["b", "c", "a"]);
  });

  it("never mutates its input", () => {
    const input = [b, a, c];
    const before = ids(input);
    sortReports(input, "oldest");
    expect(ids(input)).toEqual(before);
  });

  describe("awaiting re-score first", () => {
    it("ranks failed above pending above done", () => {
      const done = report("done", "2026-10-04T00:00:00Z", "done");
      const pending = report("pending", "2026-10-03T00:00:00Z", "pending");
      const failed = report("failed", "2026-10-02T00:00:00Z", "failed");
      // Note the dates run the other way, so a date-only sort would give the
      // exact opposite order -- this fails if urgency is ignored.
      expect(ids(sortReports([done, pending, failed], "rescore"))).toEqual([
        "failed",
        "pending",
        "done",
      ]);
    });

    it("breaks ties by date, newest first", () => {
      const older = report("older", "2026-09-01T00:00:00Z", "pending");
      const newer = report("newer", "2026-10-01T00:00:00Z", "pending");
      expect(ids(sortReports([older, newer], "rescore"))).toEqual(["newer", "older"]);
    });

    it("treats an unknown state as settled, not as a problem", () => {
      // rescoreState is null when add_monitoring_reports_rescore_state.sql has
      // not been run. Ranking null as urgent would flag every report on such an
      // instance, which is noise rather than information.
      const unknown = report("unknown", "2026-10-04T00:00:00Z", null);
      const pending = report("pending", "2026-09-01T00:00:00Z", "pending");
      expect(ids(sortReports([unknown, pending], "rescore"))).toEqual(["pending", "unknown"]);
    });

    it("falls back to date order when nothing needs attention", () => {
      // The live case: every report settled. The control must still produce a
      // sensible list rather than an arbitrary one.
      expect(ids(sortReports([b, a, c], "rescore"))).toEqual(["a", "c", "b"]);
    });
  });
});
