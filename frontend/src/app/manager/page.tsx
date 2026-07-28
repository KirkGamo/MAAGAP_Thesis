import { createClient } from "@/lib/supabase/server";
import { Card } from "@/components/tremor/card";
import { Metric, MetricLabel } from "@/components/tremor/metric";
import { Tracker, type TrackerBlockProps } from "@/components/tremor/tracker";
import { BarChart } from "@/components/tremor/bar-chart";
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

// Tremor's BarChart colors bars by category name, drawing from a fixed
// palette of named colors (see components/tremor/chart-utils.ts) rather
// than arbitrary hex/Tailwind classes -- that fixed set has no "red", so
// "amber" (this app's Chapter 3 alert color) and "emerald" (this app's
// existing "safe/low-risk" color everywhere else -- Tracker above, the
// Risk Map's pins, badge.tsx) are the closest available match.
const HIGH_RISK_CATEGORY = "High/Critical";
const LOW_RISK_CATEGORY = "Low/Medium";
const MAX_MUNICIPALITIES_SHOWN = 10;
const MAX_TRACKER_BLOCKS = 120;

/**
 * Manager overview: Phase 10 replaces the hand-built KPI cards with
 * genuine Tremor Raw components (Card, a small Metric primitive built in
 * Tremor Raw's own conventions since Tremor Raw doesn't ship one -- see
 * components/tremor/metric.tsx's comment -- Tracker, and BarChart). Same
 * live (ongoing) project population `ml-service/optimization_engine.py`
 * scores; a scheduled job/webhook keeps `projects` in sync with the ML
 * service's scoring output (see actions/submit-report.ts's docstring for
 * the feedback loop that refreshes these scores, and
 * scripts/seed_supabase.py for how the table is populated from the batch
 * pipeline's output).
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

  // Group by municipality: how many High/Critical vs. Low/Medium projects
  // in each. Projects with no resolved municipality (see
  // src/lib/municipality-coordinates.ts / optimization_engine.py's
  // resolve_municipality "Unmapped" fallback) are excluded from this
  // chart -- there's no meaningful bar to plot them under -- rather than
  // silently lumped into a misleading catch-all category.
  const byMunicipality = new Map<string, { high: number; low: number }>();
  for (const row of rows) {
    const municipality = row.municipality;
    const tier = row.risk_tier as RiskTier | null;
    if (!municipality || !tier) continue;
    const bucket = byMunicipality.get(municipality) ?? { high: 0, low: 0 };
    if (tier === "High" || tier === "Critical") bucket.high += 1;
    else bucket.low += 1;
    byMunicipality.set(municipality, bucket);
  }
  const municipalityChartData = Array.from(byMunicipality.entries())
    .map(([municipality, { high, low }]) => ({
      municipality,
      [HIGH_RISK_CATEGORY]: high,
      [LOW_RISK_CATEGORY]: low,
      total: high + low,
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, MAX_MUNICIPALITIES_SHOWN)
    .map(({ total: _total, ...rest }) => rest);

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
        <MetricLabel>
          High/Critical vs. Low/Medium risk projects by municipality (top {MAX_MUNICIPALITIES_SHOWN})
        </MetricLabel>
        {municipalityChartData.length > 0 ? (
          <BarChart
            className="mt-4"
            data={municipalityChartData}
            index="municipality"
            categories={[HIGH_RISK_CATEGORY, LOW_RISK_CATEGORY]}
            colors={["amber", "emerald"]}
            // No valueFormatter prop: this page is a Server Component, and
            // functions (including inline arrow functions) cannot be passed
            // as props across the server/client boundary to BarChart (a
            // "use client" component) — React only allows Server Actions
            // ("use server" functions) to cross that boundary. BarChart's
            // own default, `(value) => value.toString()`, is functionally
            // identical to what was passed here, so it's simply omitted
            // rather than worked around.
            yAxisWidth={40}
          />
        ) : (
          <p className="mt-3 text-sm text-slate-400">
            No scored projects with a resolved municipality yet.
          </p>
        )}
      </Card>

      <Card>
        <p className="font-semibold text-gray-900">Next steps</p>
        <p className="mt-2 text-sm text-gray-500">
          Use <span className="font-medium text-brand-navy">Import Projects</span> to bring in
          new monitoring data, <span className="font-medium text-brand-navy">Backlog</span> to
          review and filter every tracked project, and{" "}
          <span className="font-medium text-brand-navy">Schedule</span> to deploy the latest
          PuLP-optimized inspector routes.
        </p>
      </Card>
    </div>
  );
}
