import { createClient } from "@/lib/supabase/server";
import { Metric, MetricLabel } from "@/components/tremor/metric";
import { FolderKanban, AlertTriangle, Gauge } from "lucide-react";

/**
 * Phase 13: the sticky inline KPI row's data-fetching, pulled out of
 * layout.tsx into its own async Server Component so it can be wrapped in a
 * <Suspense> boundary (see layout.tsx) with its own small skeleton
 * fallback. Before this split, these three queries were awaited directly
 * inside the layout itself -- since a layout wraps every /manager/* page,
 * that meant the ENTIRE shell (sidebar, header, nav) sat blank until these
 * KPI queries resolved, even though none of them are needed to render the
 * sidebar or top bar. Now the shell paints immediately and only this row
 * shows a brief skeleton pulse while it loads.
 */
export async function KpiHeader() {
  const supabase = await createClient();

  const [activeProjects, criticalProjects, scheduledThisWeek] = await Promise.all([
    supabase.from("projects").select("id", { count: "exact", head: true }).eq("status", "on_going"),
    supabase
      .from("projects")
      .select("id", { count: "exact", head: true })
      .eq("status", "on_going")
      .eq("risk_tier", "Critical"),
    // "Optimized Inspector Capacity": what fraction of currently-ongoing
    // projects already have an inspector deployment assigned via the most
    // recent PuLP solve (see ml-service/optimization_engine.py,
    // inspector_schedules). Deliberately not a fabricated capacity/
    // utilization percentage -- there's no per-inspector max-capacity
    // figure anywhere in this schema to divide by -- this is a real,
    // honestly-labeled coverage ratio instead: assigned vs. total ongoing.
    supabase.from("inspector_schedules").select("project_id"),
  ]);

  const totalActive = activeProjects.count ?? 0;
  const criticalCount = criticalProjects.count ?? 0;
  const distinctScheduledProjects = new Set(
    (scheduledThisWeek.data ?? []).map((r) => r.project_id)
  ).size;
  const capacityPct = totalActive > 0 ? Math.round((distinctScheduledProjects / totalActive) * 100) : 0;

  return (
    <div className="grid grid-cols-1 divide-y divide-brand-navy/10 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
      <div className="flex items-start gap-3 py-3 first:pt-0 sm:px-6 sm:py-0 sm:first:pl-0">
        <FolderKanban className="mt-0.5 size-5 shrink-0 text-brand-blue" aria-hidden="true" />
        <div>
          <MetricLabel>Total Active Projects</MetricLabel>
          <Metric>{totalActive.toLocaleString()}</Metric>
        </div>
      </div>
      <div className="flex items-start gap-3 py-3 sm:px-6 sm:py-0">
        <AlertTriangle
          className={`mt-0.5 size-5 shrink-0 ${criticalCount > 0 ? "text-red-600" : "text-brand-blue"}`}
          aria-hidden="true"
        />
        <div>
          <MetricLabel>Critical Risk Load</MetricLabel>
          <Metric className={criticalCount > 0 ? "text-red-600" : undefined}>
            {criticalCount.toLocaleString()}
          </Metric>
        </div>
      </div>
      <div className="flex items-start gap-3 py-3 sm:px-6 sm:py-0 sm:last:pr-0">
        <Gauge className="mt-0.5 size-5 shrink-0 text-brand-blue" aria-hidden="true" />
        <div>
          <MetricLabel>Optimized Inspector Capacity</MetricLabel>
          <Metric>{capacityPct}%</Metric>
          <p className="mt-0.5 text-xs text-slate-400">
            {distinctScheduledProjects} of {totalActive} ongoing projects have a deployed inspector
          </p>
        </div>
      </div>
    </div>
  );
}
