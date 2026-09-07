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
 * Sizing (single-viewport Overview redesign): the component fills
 * whatever height its card gives it (`flex-1 min-h-0` + an h-full chart)
 * instead of dictating its own pixel height, so the page can lay it out
 * as a fixed-viewport grid cell. Two exceptions need explicit pixels:
 * below lg the card has no bounded height, so a min-height keeps the
 * chart from collapsing to zero; and the "All" view keeps a computed
 * per-row height inside its own scroll region -- 44 LGUs can never fit a
 * viewport-bounded cell legibly, so that scroll is intentionally internal
 * to the card while the page itself stays scroll-free.
 */

const TOP_N = 10;
const ROW_HEIGHT_PX = 28;
// x-axis ticks + chart margins, on top of the per-bar rows.
const CHART_CHROME_PX = 70;

const formatCount = (value: number) => value.toLocaleString();

export function MunicipalityPpaChart({ data }: { data: MunicipalityTypeDatum[] }) {
  const [showAll, setShowAll] = React.useState(false);

  const visible = showAll ? data : data.slice(0, TOP_N);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="inline-flex shrink-0 self-start rounded-md border border-brand-navy/10 bg-white p-0.5">
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

      {showAll ? (
        <div className="mt-2 min-h-80 flex-1 overflow-y-auto pr-2 lg:min-h-0">
          <div style={{ height: visible.length * ROW_HEIGHT_PX + CHART_CHROME_PX }}>
            <BarChart
              className="h-full"
              data={visible}
              index="municipality"
              categories={TYPE_CATEGORIES}
              colors={TYPE_COLORS}
              layout="vertical"
              type="stacked"
              yAxisWidth={120}
              showLegend={false}
              valueFormatter={formatCount}
              allowDecimals={false}
            />
          </div>
        </div>
      ) : (
        <div className="mt-2 min-h-80 flex-1 lg:min-h-0">
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
      )}
    </div>
  );
}
