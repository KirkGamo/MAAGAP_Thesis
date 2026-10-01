import { cn } from "@/lib/utils";

/**
 * F3: the Critical/High marker used on the day strip and the week matrix.
 *
 * WHAT WAS WRONG. Both places drew two 6px dots distinguished ONLY by colour —
 * red for Critical, orange for High. That is the worst available pair: red and
 * orange are close to indistinguishable under deuteranopia and protanopia,
 * which affect roughly 8% of men, and these are the smallest marks on the page.
 * For an affected user the schedule's urgency signal simply was not there.
 *
 * The only alternative text was a `title` attribute, which is not a reliable
 * accessible name — screen readers treat it inconsistently, and it never
 * appears on touch or keyboard focus at all.
 *
 * THE FIX is redundant encoding: Critical is a FILLED disc, High is a HOLLOW
 * ring. The shapes differ whether or not the colours do, so the distinction
 * survives any colour vision, a greyscale print of a defence slide, and a
 * projector that renders both as muddy brown.
 *
 * `role="img"` plus `aria-label` gives it a real accessible name rather than
 * relying on `title`. The count is included in that name because "Critical" on
 * its own does not say how many, and the visual carries the number beside it.
 */
export function RiskMarker({
  tier,
  count,
  className,
}: {
  tier: "Critical" | "High";
  count: number;
  className?: string;
}) {
  const isCritical = tier === "Critical";
  return (
    <span
      role="img"
      aria-label={`${count} ${tier}-risk visit${count === 1 ? "" : "s"}`}
      title={`${count} ${tier}-risk visit${count === 1 ? "" : "s"}`}
      className={cn(
        "inline-block size-2 shrink-0 rounded-full",
        isCritical
          ? "bg-red-600"
          : "border-[1.5px] border-orange-500 bg-transparent",
        className
      )}
    />
  );
}
