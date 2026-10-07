"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { useUrlState } from "@/lib/use-url-state";
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
  const { isPending, setParam } = useUrlState("/manager/schedule");
  // Which tab was clicked, so the feedback lands on that tab rather than on
  // all of them. Changing a day re-renders the map and the agenda from the
  // server -- measured at 902ms, previously with nothing on screen to show it.
  const [requested, setRequested] = useState<string | null>(null);

  function setDay(day: string) {
    setRequested(day);
    setParam("day", day);
  }

  return (
    <div className="inline-flex flex-wrap gap-1 self-start rounded-md border border-brand-navy/10 bg-white p-0.5">
      {tabs.map((tab) => (
        <button
          key={tab.day}
          type="button"
          onClick={() => setDay(tab.day)}
          aria-current={current === tab.day ? "true" : undefined}
          className={cn(
            "relative flex items-center gap-1.5 rounded px-3 py-1.5 text-sm font-medium transition-colors",
            current === tab.day
              ? "bg-brand-navy text-white"
              : "text-brand-navy/70 hover:bg-brand-surface",
            // The requested tab takes the selected styling immediately, so the
            // click registers before the server has answered.
            isPending && requested === tab.day && "bg-brand-navy/80 text-white"
          )}
        >
          <span>{tab.day}</span>
          <span
            className={cn(
              "text-xs tabular-nums",
              current === tab.day ? "text-white/70" : "text-ink-faint"
            )}
          >
            {tab.count}
          </span>
          {isPending && requested === tab.day && (
            <span
              aria-hidden="true"
              className="absolute inset-x-1 bottom-0.5 h-0.5 animate-pulse rounded-full bg-white/70"
            />
          )}
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
