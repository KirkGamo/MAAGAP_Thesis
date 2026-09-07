"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { BarChart } from "@/components/tremor/bar-chart";
import {
  TYPE_CATEGORIES,
  TYPE_COLORS,
  type MunicipalityTypeDatum,
} from "../lib/portfolio-stats";

/**
 * "PPAs per municipality" -- the demographics section's primary chart:
 * horizontal bars (one per LGU, sorted by total PPAs descending), stacked
 * by project type. A Top 10 / All segmented toggle (local state -- this is
 * a display mode of one widget, not a filter worth a URL param, unlike
 * ppas/view-toggle.tsx's table/map switch) expands from the ten largest
 * municipalities to every LGU in the portfolio.
 *
 * Recharts' ResponsiveContainer needs a real pixel height to draw into,
 * and Tailwind's JIT can't see runtime-computed class strings -- so the
 * "All" view sizes the chart via an inline style computed from the row
 * count (~1,300px for 44 LGUs) inside a fixed-height scroll container,
 * rather than an arbitrary h-[...] class. The legend and x-axis scroll
 * with the bars; the municipality labels stay attached to their rows,
 * which is the readability property that matters in a ranking chart.
 */

const TOP_N = 10;
const ROW_HEIGHT_PX = 32;
// Legend row + x-axis ticks + chart margins, on top of the per-bar rows.
const CHART_CHROME_PX = 100;
const ALL_VIEW_MAX_HEIGHT_PX = 512;

const formatCount = (value: number) => value.toLocaleString();

export function MunicipalityPpaChart({ data }: { data: MunicipalityTypeDatum[] }) {
  const [showAll, setShowAll] = React.useState(false);

  const visible = showAll ? data : data.slice(0, TOP_N);
  const chartHeightPx = visible.length * ROW_HEIGHT_PX + CHART_CHROME_PX;
  const needsScroll = showAll && chartHeightPx > ALL_VIEW_MAX_HEIGHT_PX;

  return (
    <div>
      <div className="inline-flex rounded-md border border-brand-navy/10 bg-white p-0.5">
        {(
          [
            { all: false, label: `Top ${TOP_N}` },
            { all: true, label: `All ${data.length}` },
          ] as const
        ).map(({ all, label }) => (
          <button
            key={label}
            type="button"
            onClick={() => setShowAll(all)}
            className={cn(
              "rounded px-3 py-1 text-xs font-medium transition-colors",
              showAll === all
                ? "bg-brand-navy text-white"
                : "text-brand-navy/70 hover:bg-brand-surface"
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <div
        className={cn("mt-3", needsScroll && "overflow-y-auto pr-2")}
        style={needsScroll ? { maxHeight: ALL_VIEW_MAX_HEIGHT_PX } : undefined}
      >
        <div style={{ height: chartHeightPx }}>
          <BarChart
            className="h-full"
            data={visible}
            index="municipality"
            categories={TYPE_CATEGORIES}
            colors={TYPE_COLORS}
            layout="vertical"
            type="stacked"
            yAxisWidth={120}
            valueFormatter={formatCount}
            allowDecimals={false}
          />
        </div>
      </div>
    </div>
  );
}
