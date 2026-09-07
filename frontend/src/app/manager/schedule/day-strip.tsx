"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";

export interface DayTabInfo {
  /** "All" or a workday ("Mon".."Fri"). */
  day: string;
  /** Total visits scheduled that day (whole week for "All"). */
  count: number;
  critical: number;
  high: number;
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
          {tab.critical > 0 && (
            <span
              className="size-1.5 rounded-full bg-red-500"
              title={`${tab.critical} Critical-risk visit(s)`}
            />
          )}
          {tab.high > 0 && (
            <span
              className="size-1.5 rounded-full bg-orange-500"
              title={`${tab.high} High-risk visit(s)`}
            />
          )}
        </button>
      ))}
    </div>
  );
}
