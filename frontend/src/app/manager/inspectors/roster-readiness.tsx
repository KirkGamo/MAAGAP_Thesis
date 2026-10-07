import type { RosterSummary } from "./lib/roster";

/**
 * The headline the Inspectors tab was missing: whether the roster can
 * actually absorb the optimizer's output. Before this, a Manager only
 * discovered that most of a solve was undeployable two tabs away, in the
 * receipt of the Schedule tab's Deploy button.
 *
 * Captions are composed as plain strings -- this repo's Next build fuses
 * JSX boundary whitespace around entities (the convention adopted on the
 * rebuilt Overview and Schedule pages).
 */
export function RosterReadiness({
  summary,
  serviceReachable,
  undeployable,
}: {
  summary: RosterSummary;
  serviceReachable: boolean;
  /** Visits the latest solve routes to slots nobody holds. */
  undeployable: number;
}) {
  const chips: { label: string; tone: "ok" | "warn" | "muted" }[] = [
    {
      label: `${summary.activeInspectors} active inspector${summary.activeInspectors === 1 ? "" : "s"}`,
      tone: summary.activeInspectors > 0 ? "ok" : "warn",
    },
  ];

  // Only countable when the solver's roster is known. Offline, `slotRows`
  // is built from the slots profiles already hold, so emptySlots is
  // necessarily 0 -- a structural artefact, not an observation. Rendering
  // it as "0 slots empty" in the ok tone turned missing data into an
  // all-clear. A number that cannot be known is not shown; the offline
  // chip below says why.
  if (serviceReachable) {
    chips.push({
      label: `${summary.emptySlots} slot${summary.emptySlots === 1 ? "" : "s"} empty`,
      tone: summary.emptySlots > 0 ? "warn" : "ok",
    });
  }
  if (undeployable > 0) {
    chips.push({
      label: `${undeployable} optimized visit${undeployable === 1 ? "" : "s"} undeployable`,
      tone: "warn",
    });
  }
  if (summary.unrostered > 0) {
    chips.push({
      label: `${summary.unrostered} inspector${summary.unrostered === 1 ? "" : "s"} with no slot`,
      tone: "warn",
    });
  }
  if (summary.inactiveInSlot > 0) {
    chips.push({
      label: `${summary.inactiveInSlot} slot${summary.inactiveInSlot === 1 ? "" : "s"} held by an inactive account`,
      tone: "warn",
    });
  }
  if (!serviceReachable) {
    chips.push({ label: "Optimizer roster unavailable — ML service offline", tone: "muted" });
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {chips.map((chip) => (
        <span
          key={chip.label}
          className={
            "rounded-md border px-2 py-1 text-[11px] " +
            (chip.tone === "warn"
              ? "border-orange-200 bg-orange-50 text-orange-700"
              : chip.tone === "ok"
                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                : "border-dashed border-brand-navy/15 text-slate-400")
          }
        >
          {chip.label}
        </span>
      ))}
    </div>
  );
}

/**
 * The one-sentence version, rendered next to the page title. Names the
 * concrete cost when the solve is known ("21 of 25 optimized visits
 * cannot be deployed") and falls back to the structural statement when
 * the ML service is unreachable.
 */
export function readinessHeadline(
  summary: RosterSummary,
  serviceReachable: boolean,
  undeployable: number,
  totalSolveVisits: number
): string {
  if (!serviceReachable && summary.totalSlots === 0) {
    return "Assign each inspector an optimizer slot so deployed schedules can reach them.";
  }
  // The roster size lives in optimization_engine.py and reaches this page only
  // through the solve. With the ML service unreachable, `slotRows` is built
  // from the slots profiles already hold, so filledSlots always equals
  // totalSlots and emptySlots is always 0 -- which previously fell through to
  // "every slot can receive deployed work", the page's strongest all-clear,
  // issued precisely when it had the least information. Observed live at
  // "1 of 1 optimizer slot filled" against a true state of 1 of 6 with 21 of
  // 25 visits undeployable.
  //
  // State what is known (slots held) and name what is not (how many exist).
  // Nothing here is cached across requests, so the last known roster size is
  // genuinely unavailable rather than merely unfetched -- see ux-audit.md.
  if (!serviceReachable) {
    const held = `${summary.filledSlots} inspector${summary.filledSlots === 1 ? "" : "s"} hold${
      summary.filledSlots === 1 ? "s" : ""
    } an optimizer slot`;
    return `${held} — the roster size is unknown while the ML service is unreachable, so empty slots and undeployable visits cannot be counted.`;
  }
  const base = `${summary.filledSlots} of ${summary.totalSlots} optimizer slot${
    summary.totalSlots === 1 ? "" : "s"
  } filled`;
  if (undeployable > 0 && totalSolveVisits > 0) {
    return `${base} — ${undeployable} of the latest solve's ${totalSolveVisits} visits cannot be deployed to anyone.`;
  }
  return summary.emptySlots > 0
    ? `${base} — work routed to the empty ones cannot be deployed.`
    : `${base} — every slot can receive deployed work.`;
}
