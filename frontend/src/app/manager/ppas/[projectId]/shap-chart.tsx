import { cn } from "@/lib/utils";
import type { ShapFeature } from "@/types/database";

/**
 * Phase 22: renders `projects.shap_top_features` as a diverging
 * (tornado-style) horizontal bar chart -- each bar grows from a center
 * zero-line toward the right (red, pushes toward higher risk) or left
 * (emerald, pushes toward lower risk), scaled to the largest |shap_value|
 * among the features shown so the biggest driver always reads as a full-
 * width bar.
 *
 * A plain custom component rather than this app's Tremor/Recharts
 * BarChart (see components/tremor/bar-chart.tsx) -- that wrapper's color
 * model is built around named categories/series, not a single series of
 * signed values that need per-bar coloring by sign, and fighting it into
 * that shape would be more code than this ~40-line diverging bar.
 *
 * No "use client" -- purely presentational, computed entirely from props,
 * so it stays a Server Component like its parent page.
 */
export function ShapChart({ features }: { features: ShapFeature[] }) {
  const maxAbs = Math.max(...features.map((f) => Math.abs(f.shap_value)), 0.0001);

  return (
    <div className="flex flex-col gap-2.5">
      {features.map((f) => {
        const pushesUp = f.direction === "increases_risk";
        const widthPct = (Math.abs(f.shap_value) / maxAbs) * 50;
        const pp = (f.shap_value * 100).toFixed(1);

        return (
          <div key={f.feature} className="flex items-center gap-3">
            <span className="w-40 shrink-0 truncate text-right text-xs text-slate-600" title={f.label}>
              {f.label}
            </span>
            <div className="relative h-5 min-w-0 flex-1 rounded bg-slate-100">
              <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-slate-300" />
              <div
                className={cn(
                  "absolute inset-y-0 rounded",
                  pushesUp ? "left-1/2 bg-red-500" : "right-1/2 bg-emerald-500"
                )}
                style={{ width: `${widthPct}%` }}
              />
            </div>
            <span
              className={cn(
                "w-16 shrink-0 text-right text-xs font-medium tabular-nums",
                pushesUp ? "text-red-600" : "text-emerald-600"
              )}
            >
              {pushesUp ? "+" : ""}
              {pp} pp
            </span>
          </div>
        );
      })}
    </div>
  );
}
