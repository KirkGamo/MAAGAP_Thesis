import { createClient } from "@/lib/supabase/server";
import { Card } from "@/components/tremor/card";
import { Metric, MetricLabel } from "@/components/tremor/metric";
import { Tracker, type TrackerBlockProps } from "@/components/tremor/tracker";
import type { RiskTier } from "@/types/database";

const TIER_ORDER: RiskTier[] = ["Critical", "High", "Medium", "Low"];

// Same tier -> color convention used by the Risk Map's pin legend
// (project-risk-map.tsx) and badge.tsx's riskTierVariant, reused here so
// "red means Critical" means the same thing everywhere in the app.
const TIER_ACCENT: Record<RiskTier, string> = {
  Critical: "border-l-4 border-l-red-600",
  High: "border-l-4 border-l-orange-500",
  Medium: "border-l-4 border-l-amber-500",
  Low: "border-l-4 border-l-emerald-500",
};

const TIER_TRACKER_COLOR: Record<RiskTier, string> = {
  Critical: "bg-red-600",
  High: "bg-orange-500",
  Medium: "bg-amber-500",
  Low: "bg-emerald-600",
};

const MAX_TRACKER_BLOCKS = 120;

/**
 * Manager overview: Phase 10 replaced the hand-built KPI cards with genuine
 * Tremor Raw components (Card, a small Metric primitive built in Tremor
 * Raw's own conventions since Tremor Raw doesn't ship one -- see
 * components/tremor/metric.tsx's comment -- and Tracker).
 *
 * PHASE 11: the municipality BarChart and Risk Map that used to live on
 * this page/its own /manager/map route both moved to the new Monitoring
 * tab (see app/manager/monitoring/page.tsx) — this page keeps the
 * per-tier counts and the Tracker distribution strip, which are genuinely
 * "at a glance" overview content, while the two municipality/spatial
 * views (which both answer "where" rather than "how many") live together
 * one tab over. The three headline KPIs (Total Active Projects, Critical
 * Risk Load, Optimized Inspector Capacity) that used to implicitly live
 * here now live in the shared sticky header above every tab (see
 * ../layout.tsx), since they're meant to stay visible regardless of which
 * tab a Manager is on.
 */
export default async function ManagerOverviewPage() {
  const supabase = await createClient();

  const { data: projects } = await supabase
    .from("projects")
    .select("risk_tier, municipality")
    .not("risk_tier", "is", null);

  const rows = projects ?? [];

  const counts: Record<RiskTier, number> = { Critical: 0, High: 0, Medium: 0, Low: 0 };
  for (const row of rows) {
    const tier = row.risk_tier as RiskTier | null;
    if (tier) counts[tier] += 1;
  }
  const totalScored = rows.length;

  // Tracker: one block per scored project (capped for render/legibility),
  // colored by risk tier -- a compact "at a glance" distribution strip
  // complementing the exact counts in the Metric cards above it.
  const trackerData: TrackerBlockProps[] = rows
    .filter((row) => row.risk_tier)
    .slice(0, MAX_TRACKER_BLOCKS)
    .map((row) => {
      const tier = row.risk_tier as RiskTier;
      return {
        color: TIER_TRACKER_COLOR[tier],
        tooltip: `${row.municipality ?? "Unmapped"} — ${tier}`,
      };
    });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-brand-navy">Overview</h1>
        <p className="text-sm text-slate-500">
          Live risk distribution across currently ongoing PPDO projects.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {TIER_ORDER.map((tier) => (
          <Card key={tier} className={TIER_ACCENT[tier]}>
            <MetricLabel>{tier}</MetricLabel>
            <Metric>{counts[tier]}</Metric>
          </Card>
        ))}
      </div>

      <Card>
        <MetricLabel>Risk distribution (first {trackerData.length} of {totalScored} scored projects)</MetricLabel>
        {trackerData.length > 0 ? (
          <Tracker data={trackerData} className="mt-3" hoverEffect />
        ) : (
          <p className="mt-3 text-sm text-slate-400">No scored projects yet.</p>
        )}
      </Card>

      <Card>
        <p className="font-semibold text-gray-900">Next steps</p>
        <p className="mt-2 text-sm text-gray-500">
          Use <span className="font-medium text-brand-navy">Import Projects</span> (top right) to
          bring in new monitoring data, <span className="font-medium text-brand-navy">Monitoring</span>{" "}
          to see the municipality breakdown and risk map, <span className="font-medium text-brand-navy">Backlog</span>{" "}
          to review and filter every tracked project, and{" "}
          <span className="font-medium text-brand-navy">Schedule</span> to deploy the latest
          PuLP-optimized inspector routes.
        </p>
      </Card>
    </div>
  );
}
