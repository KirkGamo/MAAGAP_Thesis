import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { Card } from "@/components/tremor/card";
import { Metric, MetricLabel } from "@/components/tremor/metric";
import type { RiskTier } from "@/types/database";
import { KpiHeader } from "./kpi-header";
import { KpiHeaderSkeleton } from "./kpi-header-skeleton";
import { MunicipalityPpaChart } from "./charts/municipality-ppa-chart";
import { CountBarChart } from "./charts/count-bar-chart";
import { CurrencyBarChart } from "./charts/currency-bar-chart";
import {
  budgetByMunicipality,
  BUDGET_CATEGORY,
  countByMunicipalityAndType,
  countByStatus,
  countByType,
  countByYearAndType,
  STATUS_COUNT_CATEGORY,
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

// 5, not 10: in the single-viewport layout this chart's cell is ~150-200px
// of plot height, and more category rows than this push Recharts into
// tick thinning that leaves bars unlabeled (verified empirically: 7 rows
// at 1366x768 still lost every other label) -- 5 keeps every bar labeled
// on the smallest supported laptop viewport.
const MAX_BUDGET_MUNICIPALITIES = 5;

// PostgREST caps a single select at 1,000 rows (the same limit the PPAs
// map view designs around via MAP_MARKER_LIMIT), and the demographics
// charts need the WHOLE seeded portfolio (~2,393 rows) -- so the fetch
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
 * Manager overview, laid out to fit a single desktop/laptop viewport with
 * no page scrolling (the user's explicit call after the demographics
 * revamp -- see DASHBOARD_UI_IMPROVEMENT_PLAN.md for the revamp itself).
 *
 * Layout: at lg+ the page pins itself to the viewport remainder
 * (100dvh minus the portal header (~61px) and main's py-6 -- 7.25rem
 * leaves a few px of slack) and becomes a fixed grid: a slim top strip
 * (the three portal KPIs + the four risk-tier counts with a coverage
 * note), then a 2x2 chart grid where "PPAs per municipality" spans both
 * rows and the right column holds "PPAs per year" over the status/budget
 * pair. Charts fill their grid cells (h-full into minmax(0,1fr) tracks)
 * instead of carrying fixed heights. Below lg there is no bounded
 * viewport worth designing to, so everything stacks and scrolls normally
 * (charts keep explicit min-heights so flex-1 can't collapse them).
 *
 * Cut in this redesign (git history preserves them): the page heading
 * block, the Tracker strip, the High/Critical-vs-Low/Medium municipality
 * BarChart (redundant next to the demographics municipality chart), the
 * project-type percent bar (its exact counts moved into the year card's
 * caption; the type split itself is every stacked chart's legend), and
 * the "Next steps" onboarding card.
 *
 * Data notes that survive from the revamp: demographics describe ALL
 * seeded rows via ONE paged fetch (the pre-revamp page's scored-only
 * query silently hid the ~72% of live projects that are unscored -- no
 * matching LSTM sequence, the long-standing coverage caveat); the risk
 * tier counts filter to scored rows in memory; every excluded row is
 * surfaced in a caption, never silently dropped; and demographic charts
 * draw only from blue/cyan/violet/gray (see portfolio-stats.ts's
 * TYPE_COLORS comment) so amber/emerald/red stay reserved for risk.
 */
export default async function ManagerOverviewPage() {
  const supabase = await createClient();

  const rows = await fetchPortfolioRows(supabase);
  const scoredRows = rows.filter((row) => row.risk_tier != null);

  const municipality = countByMunicipalityAndType(rows);
  const years = countByYearAndType(rows);
  const statuses = countByStatus(rows);
  const types = countByType(rows);
  const budget = budgetByMunicipality(rows, MAX_BUDGET_MUNICIPALITIES);

  const tierCounts: Record<RiskTier, number> = { Critical: 0, High: 0, Medium: 0, Low: 0 };
  for (const row of scoredRows) {
    tierCounts[row.risk_tier as RiskTier] += 1;
  }

  // Captions are composed as plain strings (not JSX text nodes) -- immune
  // to this repo's Next build fusing boundary whitespace around entities,
  // and easy to keep to one compact line each in the fixed-height layout.
  const scoredCaption =
    `Model risk tiers cover ${scoredRows.length.toLocaleString()} of ` +
    `${rows.length.toLocaleString()} live PPAs; the rest lack the LSTM ` +
    `monitoring-event sequence and stay unscored rather than guessed.`;

  const municipalityCaption =
    municipality.excludedNoMunicipality > 0
      ? `${municipality.excludedNoMunicipality.toLocaleString()} PPAs without a resolved municipality are not charted.`
      : null;

  const yearCaption = [
    years.undatedCount > 0
      ? `${years.undatedCount.toLocaleString()} undated PPAs` +
        (years.includesUndatedBucket ? " — the right-most bar" : " not charted")
      : null,
    `Infrastructure ${types.counts.Infrastructure.toLocaleString()}`,
    `Non-Infrastructure ${types.counts["Non-Infrastructure"].toLocaleString()}`,
    `Unclassified ${types.counts.Unclassified.toLocaleString()}`,
  ]
    .filter(Boolean)
    .join(" · ");

  const budgetCaption =
    budget.excludedNoAmount + budget.excludedNoMunicipality > 0
      ? "Excludes " +
        [
          budget.excludedNoAmount > 0
            ? `${budget.excludedNoAmount.toLocaleString()} PPAs with no recorded amount`
            : null,
          budget.excludedNoMunicipality > 0
            ? `${budget.excludedNoMunicipality.toLocaleString()} PPAs with no resolved municipality`
            : null,
        ]
          .filter(Boolean)
          .join(" and ") +
        "."
      : null;

  return (
    <div className="flex flex-col gap-3 lg:h-[calc(100dvh-7.25rem)] lg:min-h-135 lg:overflow-hidden">
      {/* ---- Top strip: portal KPIs + risk-tier counts ---- */}
      <div className="grid shrink-0 gap-3 lg:grid-cols-[1.2fr_1fr]">
        <Card className="p-4">
          <Suspense fallback={<KpiHeaderSkeleton />}>
            <KpiHeader />
          </Suspense>
        </Card>

        <Card className="p-4">
          <div className="grid grid-cols-4 gap-2">
            {TIER_ORDER.map((tier) => (
              <div key={tier} className={`pl-2 ${TIER_ACCENT[tier]}`}>
                <MetricLabel className="text-xs">{tier}</MetricLabel>
                <Metric className="text-2xl">{tierCounts[tier].toLocaleString()}</Metric>
              </div>
            ))}
          </div>
          <p className="mt-1.5 text-[11px] leading-tight text-slate-400">{scoredCaption}</p>
        </Card>
      </div>

      {/* ---- Chart grid ---- */}
      <div className="grid gap-3 lg:min-h-0 lg:flex-1 lg:grid-cols-2 lg:grid-rows-2">
        <Card className="flex flex-col p-4 lg:row-span-2 lg:min-h-0">
          <div className="mb-2 flex shrink-0 items-baseline justify-between gap-2">
            <MetricLabel>PPAs per municipality</MetricLabel>
            {municipalityCaption && (
              <p className="truncate text-[11px] text-slate-400">{municipalityCaption}</p>
            )}
          </div>
          {municipality.data.length > 0 ? (
            <MunicipalityPpaChart data={municipality.data} />
          ) : (
            <p className="text-sm text-slate-400">No PPAs with a resolved municipality yet.</p>
          )}
        </Card>

        <Card className="flex flex-col p-4 lg:min-h-0">
          <MetricLabel className="shrink-0">PPAs per year of fund release</MetricLabel>
          {years.data.length > 0 ? (
            <>
              <div className="mt-2 min-h-60 flex-1 lg:min-h-0">
                <CountBarChart
                  className="h-full"
                  data={years.data}
                  index="year"
                  categories={TYPE_CATEGORIES}
                  colors={TYPE_COLORS}
                  type="stacked"
                />
              </div>
              <p className="mt-1.5 shrink-0 text-[11px] leading-tight text-slate-400">
                {yearCaption}
              </p>
            </>
          ) : (
            <p className="mt-3 text-sm text-slate-400">No PPAs with a recorded release date yet.</p>
          )}
        </Card>

        <div className="grid gap-3 sm:grid-cols-2 lg:min-h-0">
          <Card className="flex flex-col p-4 lg:min-h-0">
            <MetricLabel className="shrink-0">PPAs by status</MetricLabel>
            <div className="mt-2 min-h-60 flex-1 lg:min-h-0">
              <CountBarChart
                className="h-full"
                data={statuses}
                index="status"
                categories={[STATUS_COUNT_CATEGORY]}
                colors={["blue"]}
                layout="vertical"
                showLegend={false}
                yAxisWidth={120}
              />
            </div>
          </Card>

          <Card className="flex flex-col p-4 lg:min-h-0">
            <MetricLabel className="shrink-0">
              Amount per municipality (top {MAX_BUDGET_MUNICIPALITIES})
            </MetricLabel>
            {budget.data.length > 0 ? (
              <>
                <div className="mt-2 min-h-60 flex-1 lg:min-h-0">
                  <CurrencyBarChart
                    className="h-full"
                    data={budget.data}
                    index="municipality"
                    categories={[BUDGET_CATEGORY]}
                    colors={["violet"]}
                    layout="vertical"
                    showLegend={false}
                    yAxisWidth={100}
                  />
                </div>
                {budgetCaption && (
                  <p className="mt-1.5 shrink-0 text-[11px] leading-tight text-slate-400">
                    {budgetCaption}
                  </p>
                )}
              </>
            ) : (
              <p className="mt-3 text-sm text-slate-400">No PPAs with a recorded amount yet.</p>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
