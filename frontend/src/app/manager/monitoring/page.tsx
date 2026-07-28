import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Card as TremorCard } from "@/components/tremor/card";
import { MetricLabel } from "@/components/tremor/metric";
import { BarChart } from "@/components/tremor/bar-chart";
import { MapLoader } from "../map/map-loader";
import type { MapProject } from "../map/types";
import type { RiskTier } from "@/types/database";

const HIGH_RISK_CATEGORY = "High/Critical";
const LOW_RISK_CATEGORY = "Low/Medium";
const MAX_MUNICIPALITIES_SHOWN = 10;

/**
 * Phase 11, Task 4: Monitoring tab. Combines what were previously two
 * separate destinations -- the Overview page's municipality BarChart and
 * the standalone /manager/map Risk Map page -- into one tab, each wrapped
 * in a standardized Tremor Card with matching padding/border, per this
 * phase's request. The Risk Map component itself (../map/project-risk-map.tsx)
 * and its loader/types are unchanged in place -- only where they're
 * rendered from moved -- and the map now clusters its markers (see
 * project-risk-map.tsx's MarkerClusterGroup) for the up-to-1,000-project
 * Western Visayas view.
 */
export default async function MonitoringPage() {
  const supabase = await createClient();

  const [{ data: scoredProjects }, { data: mapProjects, error: mapError }] = await Promise.all([
    supabase.from("projects").select("risk_tier, municipality").not("risk_tier", "is", null),
    supabase
      .from("projects")
      .select("id, project_key, name_of_project, municipality, risk_tier, risk_probability")
      .eq("status", "on_going")
      .limit(1000),
  ]);

  const rows = scoredProjects ?? [];
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

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-brand-navy">Monitoring</h1>
        <p className="text-sm text-slate-500">
          Spatial and municipality-level view of the ongoing project population.
        </p>
      </div>

      <TremorCard>
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
            yAxisWidth={40}
          />
        ) : (
          <p className="mt-3 text-sm text-slate-400">
            No scored projects with a resolved municipality yet.
          </p>
        )}
      </TremorCard>

      <Card>
        <CardHeader>
          <CardTitle>{mapProjects?.length ?? 0} ongoing project(s) on the map</CardTitle>
          <CardDescription>
            Green = Low &middot; Yellow = Medium &middot; Orange = High &middot; Red = Critical.
            Pins cluster at province-wide zoom levels; zoom in to split a cluster into its
            individual projects. Coordinates are approximate town-center placements (see
            src/lib/municipality-coordinates.ts) — verify against a surveyed source before using
            this for anything requiring precise geolocation.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {mapError && <p className="text-sm text-red-600">{mapError.message}</p>}
          <MapLoader projects={(mapProjects as MapProject[]) ?? []} />
        </CardContent>
      </Card>
    </div>
  );
}
