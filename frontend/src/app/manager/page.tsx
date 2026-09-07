import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { Card } from "@/components/tremor/card";
import { Metric, MetricLabel } from "@/components/tremor/metric";
import { Tracker, type TrackerBlockProps } from "@/components/tremor/tracker";
import { BarChart } from "@/components/tremor/bar-chart";
import type { RiskTier } from "@/types/database";
import { KpiHeader } from "./kpi-header";
import { KpiHeaderSkeleton } from "./kpi-header-skeleton";
import { MunicipalityPpaChart } from "./charts/municipality-ppa-chart";
import { CountBarChart } from "./charts/count-bar-chart";
import {
  countByMunicipalityAndType,
  countByYearAndType,
  TYPE_CATEGORIES,
  TYPE_COLORS,
  type PortfolioRow,
} from "./lib/portfolio-stats";

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

// PostgREST caps a single select at 1,000 rows (the same limit the PPAs
// map view designs around via MAP_MARKER_LIMIT), and the demographics
// section needs the WHOLE seeded portfolio (~2,393 rows) -- so the fetch
// pages in chunks, ordered by id for a stable page boundary.
const PORTFOLIO_FETCH_CHUNK = 1000;

async function fetchPortfolioRows(
  supabase: Awaited<ReturnType<typeof createClient>>
): Promise<PortfolioRow[]> {
  const rows: PortfolioRow[] = [];
  for (let from = 0; ; from += PORTFOLIO_FETCH_CHUNK) {
    const { data } = await supabase
      .from("projects")
      .select("municipality, status, project_type, amount_php, date_released, risk_tier")
      .order("id", { ascending: true })
      .range(from, from + PORTFOLIO_FETCH_CHUNK - 1);
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < PORTFOLIO_FETCH_CHUNK) break;
  }
  return rows;
}

/**
 * Manager overview. Two sections since the demographics revamp (see
 * DASHBOARD_UI_IMPROVEMENT_PLAN.md at the repo root):
 *
 * 1. "Portfolio demographics" -- descriptive charts over the ENTIRE
 *    seeded portfolio (PPAs per municipality, per year, and the
 *    status/type/budget breakdowns), built from lib/portfolio-stats.ts's
 *    pure aggregation helpers. Before this section existed, every visual
 *    on the page filtered to `risk_tier != null`, which silently hid the
 *    ~72% of live projects that are unscored (no matching LSTM sequence
 *    -- the long-standing meta-learner coverage caveat, not a defect).
 *
 * 2. "Risk assessment" -- the pre-existing scored-only widgets (tier
 *    cards, Tracker strip, High/Critical-by-municipality BarChart),
 *    unchanged in behavior but now explicitly labeled with how much of
 *    the portfolio they cover.
 *
 * Both sections derive from ONE paged fetch of `projects` (see
 * fetchPortfolioRows) -- demographics aggregate every row, the risk
 * widgets filter to scored rows in memory, so the scoping difference is
 * visible in code instead of buried in two slightly-different queries.
 *
 * Color discipline: demographic charts use blue/cyan/violet/gray only
 * (see portfolio-stats.ts's TYPE_COLORS comment); amber/emerald/red/
 * orange remain reserved for risk semantics, so a description never
 * reads as an alarm.
 *
 * Earlier layout history (Phases 10-12, 18: Tremor Raw adoption, the
 * short-lived Monitoring tab, the KPI header's move from layout.tsx into
 * this page's own Suspense boundary) is preserved in git history and the
 * respective components' comments.
 */
export default async function ManagerOverviewPage() {
  const supabase = await createClient();

  const rows = await fetchPortfolioRows(supabase);
  const scoredRows = rows.filter((row) => row.risk_tier != null);

  // -- Portfolio demographics (all rows) --------------------------------
  const municipality = countByMunicipalityAndType(rows);
  const years = countByYearAndType(rows);

  // -- Risk assessment (scored rows only) -------------------------------
  const counts: Record<RiskTier, number> = { Critical: 0, High: 0, Medium: 0, Low: 0 };
  for (const row of scoredRows) {
    counts[row.risk_tier as RiskTier] += 1;
  }
  const totalScored = scoredRows.length;

  // Group by municipality: how many High/Critical vs. Low/Medium projects
  // in each. Projects with no resolved municipality (see
  // src/lib/municipality-coordinates.ts / optimization_engine.py's
  // resolve_municipality "Unmapped" fallback) are excluded from this
  // chart -- there's no meaningful bar to plot them under -- rather than
  // silently lumped into a misleading catch-all category.
  const byMunicipality = new Map<string, { high: number; low: number }>();
  for (const row of scoredRows) {
    if (!row.municipality) continue;
    const bucket = byMunicipality.get(row.municipality) ?? { high: 0, low: 0 };
    if (row.risk_tier === "High" || row.risk_tier === "Critical") bucket.high += 1;
    else bucket.low += 1;
    byMunicipality.set(row.municipality, bucket);
  }
  const riskMunicipalityChartData = Array.from(byMunicipality.entries())
    .map(([name, { high, low }]) => ({
      municipality: name,
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
  const trackerData: TrackerBlockProps[] = scoredRows
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
      <Card className="p-6">
        <Suspense fallback={<KpiHeaderSkeleton />}>
          <KpiHeader />
        </Suspense>
      </Card>

      <div>
        <h1 className="text-2xl font-semibold text-brand-navy">Overview</h1>
        <p className="text-sm text-slate-500">
          The current PPA portfolio at a glance — its composition, and the live model risk
          assessment of the scored subset.
        </p>
      </div>

      {/* ---------------- Portfolio demographics ---------------- */}
      <div>
        <h2 className="text-lg font-semibold text-brand-navy">Portfolio demographics</h2>
        <p className="text-sm text-slate-500">
          Every one of the {rows.length.toLocaleString()} PPAs currently seeded from the
          monitoring portfolio, scored or not.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <MetricLabel>PPAs per municipality</MetricLabel>
          {municipality.data.length > 0 ? (
            <>
              <div className="mt-3">
                <MunicipalityPpaChart data={municipality.data} />
              </div>
              {municipality.excludedNoMunicipality > 0 && (
                <p className="mt-2 text-xs text-slate-400">
                  {municipality.excludedNoMunicipality.toLocaleString()} PPAs without a resolved
                  municipality are not charted.
                </p>
              )}
            </>
          ) : (
            <p className="mt-3 text-sm text-slate-400">No PPAs with a resolved municipality yet.</p>
          )}
        </Card>

        <Card>
          <MetricLabel>PPAs per year of fund release</MetricLabel>
          {years.data.length > 0 ? (
            <>
              <CountBarChart
                className="mt-4"
                data={years.data}
                index="year"
                categories={TYPE_CATEGORIES}
                colors={TYPE_COLORS}
                type="stacked"
              />
              {!years.includesUndatedBucket && years.undatedCount > 0 && (
                <p className="mt-2 text-xs text-slate-400">
                  {years.undatedCount.toLocaleString()} PPAs without a recorded release date are
                  not charted.
                </p>
              )}
            </>
          ) : (
            <p className="mt-3 text-sm text-slate-400">No PPAs with a recorded release date yet.</p>
          )}
        </Card>
      </div>

      {/* ---------------- Risk assessment ---------------- */}
      <div>
        <h2 className="text-lg font-semibold text-brand-navy">Risk assessment</h2>
        <p className="text-sm text-slate-500">
          {totalScored.toLocaleString()} of {rows.length.toLocaleString()} live PPAs currently
          carry a model risk score; the rest lack the monitoring-event sequence the ensemble&apos;s
          LSTM requires and stay unscored rather than being guessed.
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
        {riskMunicipalityChartData.length > 0 ? (
          <BarChart
            className="mt-4"
            data={riskMunicipalityChartData}
            index="municipality"
            categories={[HIGH_RISK_CATEGORY, LOW_RISK_CATEGORY]}
            colors={["amber", "emerald"]}
            // No valueFormatter prop: this page is a Server Component, and
            // functions cannot be passed as props across the server/
            // client boundary to BarChart (a "use client" component) --
            // see Phase 10's fix for the full explanation. BarChart's own
            // default formatter is functionally identical to what would
            // have been passed here. (The demographics charts above DO
            // get real formatters -- via thin "use client" wrappers in
            // ./charts/ that close over them, the boundary-safe pattern.)
            yAxisWidth={40}
          />
        ) : (
          <p className="mt-3 text-sm text-slate-400">
            No scored projects with a resolved municipality yet.
          </p>
        )}
      </Card>

      <Card>
        <p className="font-semibold text-brand-navy">Next steps</p>
        <p className="mt-2 text-sm text-slate-500">
          Use <span className="font-medium text-brand-navy">Program, Projects, and Activities (PPAs)</span>{" "}
          to import new monitoring data, review the full project list, and switch to a map view;{" "}
          <span className="font-medium text-brand-navy">Schedule</span> to see the latest
          PuLP-optimized inspector routes; <span className="font-medium text-brand-navy">Inspectors</span>{" "}
          to manage who&apos;s active; and <span className="font-medium text-brand-navy">Models</span> to
          review the ML stack&apos;s validation performance.
        </p>
      </Card>
    </div>
  );
}
