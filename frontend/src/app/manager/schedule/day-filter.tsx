"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";

const DAYS = ["All", "Mon", "Tue", "Wed", "Thu", "Fri"] as const;

/** Day-of-week filter for the Schedule map (Phase 12). Only affects which
 * day's pins the map shows — the per-inspector itinerary cards below it
 * intentionally keep showing the full week (each card already breaks its
 * own assignments out by day), so this filter doesn't duplicate that same
 * grouping logic a second time. */
export function DayFilter({ current }: { current: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function setDay(day: string) {
    const next = new URLSearchParams(searchParams.toString());
    if (day === "All") next.delete("day");
    else next.set("day", day);
    router.push(`/manager/schedule?${next.toString()}`);
  }

  return (
    <div className="inline-flex flex-wrap gap-1 rounded-md border border-brand-navy/10 bg-white p-0.5">
      {DAYS.map((day) => (
        <button
          key={day}
          type="button"
          onClick={() => setDay(day)}
          className={cn(
            "rounded px-3 py-1.5 text-sm font-medium transition-colors",
            current === day
              ? "bg-brand-navy text-white"
              : "text-brand-navy/70 hover:bg-brand-surface"
          )}
        >
          {day}
        </button>
      ))}
    </div>
  );
}
