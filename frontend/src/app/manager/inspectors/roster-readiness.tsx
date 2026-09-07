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
}: {
  summary: RosterSummary;
  serviceReachable: boolean;
}) {
  const headline = serviceReachable
    ? `${summary.filledSlots} of ${summary.totalSlots} optimizer slots filled`
    : summary.totalSlots > 0
      ? `${summary.filledSlots} of ${summary.totalSlots} known slots filled`
      : "No optimizer slots assigned yet";

  const chips: { label: string; tone: "ok" | "warn" | "muted" }[] = [
    {
      label: `${summary.activeInspectors} active inspector${summary.activeInspectors === 1 ? "" : "s"}`,
      tone: summary.activeInspectors > 0 ? "ok" : "warn",
    },
    {
      label: `${summary.emptySlots} slot${summary.emptySlots === 1 ? "" : "s"} empty`,
      tone: summary.emptySlots > 0 ? "warn" : "ok",
    },
  ];
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
      <span className="sr-only">{headline}</span>
    </div>
  );
}

/** The one-sentence version, rendered next to the page title. */
export function readinessHeadline(
  summary: RosterSummary,
  serviceReachable: boolean
): string {
  if (!serviceReachable && summary.totalSlots === 0) {
    return "Assign each inspector an optimizer slot so deployed schedules can reach them.";
  }
  const base = `${summary.filledSlots} of ${summary.totalSlots} optimizer slot${
    summary.totalSlots === 1 ? "" : "s"
  } filled`;
  return summary.emptySlots > 0
    ? `${base} — work routed to the empty ones cannot be deployed.`
    : `${base} — every slot can receive deployed work.`;
}
