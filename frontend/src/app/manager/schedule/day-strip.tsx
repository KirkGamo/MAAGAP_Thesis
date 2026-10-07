"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { RiskMarker } from "./risk-marker";
import { DAILY_CAPACITY } from "./capacity";

export interface DayTabInfo {
  /** "All" or a workday ("Mon".."Fri"). */
  day: string;
  /** Total visits scheduled that day (whole week for "All"). */
  count: number;
  critical: number;
  high: number;
  /** An inspector exceeds the solver's daily capacity on this day (the whole
   * week for "All"). Capacity warnings already exist per inspector inside the
   * agenda, but only for the day being viewed -- so a day with an overloaded
   * inspector was indistinguishable from a quiet one until you clicked it. */
  overCapacity: boolean;
}

/**
 * The schedule workspace's day tabs (replaces the old day-filter.tsx,
 * which only filtered the map). Drives BOTH panes -- map and agenda --
 * via the same `day` URL param, and carries just enough summary per tab
 * (visit count, Critical/High presence dots) that the whole week stays
 * scannable while only one day's detail is rendered at a time. That
 * progressive disclosure is the workspace's core information-overload
 * defense: see SCHEDULE_WORKFLOW_IMPROVEMENT_PLAN.md section 3.
 */
export function DayStrip({ tabs, current }: { tabs: DayTabInfo[]; current: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function setDay(day: string) {
    const next = new URLSearchParams(searchParams.toString());
    next.set("day", day);
    router.push(`/manager/schedule?${next.toString()}`);
  }

  return (
    <div className="inline-flex flex-wrap gap-1 self-start rounded-md border border-brand-navy/10 bg-white p-0.5">
      {tabs.map((tab) => (
        <button
          key={tab.day}
          type="button"
          onClick={() => setDay(tab.day)}
          className={cn(
            "flex items-center gap-1.5 rounded px-3 py-1.5 text-sm font-medium transition-colors",
            current === tab.day
              ? "bg-brand-navy text-white"
              : "text-brand-navy/70 hover:bg-brand-surface"
          )}
        >
          <span>{tab.day}</span>
          <span
            className={cn(
              "text-xs tabular-nums",
              current === tab.day ? "text-white/70" : "text-slate-400"
            )}
          >
            {tab.count}
          </span>
          {tab.critical > 0 && <RiskMarker tier="Critical" count={tab.critical} />}
          {tab.high > 0 && <RiskMarker tier="High" count={tab.high} />}
          {tab.overCapacity && (
            // Deliberately a glyph with a title and an accessible label, not a
            // colour change: the tab's own selected/unselected state already
            // owns its background, and capacity is not a risk tier, so it must
            // not borrow the risk palette.
            <span
              title={`An inspector is over the optimizer's daily capacity of ${DAILY_CAPACITY} on this day`}
              className={cn(
                "text-xs leading-none",
                current === tab.day ? "text-amber-200" : "text-amber-600"
              )}
            >
              <span aria-hidden="true">&#9650;</span>
              <span className="sr-only">over capacity</span>
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
