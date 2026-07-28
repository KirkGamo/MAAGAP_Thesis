import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { PpaFilterSidebar } from "./ppa-filter-sidebar";
import { PpaActiveFilters } from "./ppa-active-filters";
import { PpaSearchBar } from "./ppa-search-bar";
import { PpaImportPanel } from "./ppa-import-panel";
import { ViewToggle, type PpaView } from "./view-toggle";
import { MapLoader } from "../map/map-loader";
import type { MapProject } from "../map/types";
import { PpasDataTable } from "./data-table";
import { ppaColumns } from "./columns";
import { RISK_TIERS, STATUSES, PROJECT_TYPES, applyPpaFilters, type PpaFilterParams } from "./filters";

// Table view is paginated for real (see PAGE_SIZE below) -- this used to be
// a flat `.limit(200)` with no way to reach project #201 onward, which
// silently hid the other ~3,800 projects once the imported dataset grew
// past 200 rows. Map view isn't paginated the same way: a map is browsed by
// panning/zooming, not "next page", so it instead takes the top
// MAP_MARKER_LIMIT rows by risk (the same ordering the table uses) --
// react-leaflet-cluster (see ../map/project-risk-map.tsx) was already
// built to handle clustering roughly this many markers cleanly at
// province-wide zoom.
const PAGE_SIZE = 50;
const MAP_MARKER_LIMIT = 1000;

interface PpasPageProps {
  searchParams: Promise<
    PpaFilterParams & {
      view?: string;
      page?: string;
    }
  >;
}

/**
 * Program, Projects, and Activities (PPAs) — Phase 12 replaces the plain
 * "Backlog" page (renamed from /manager/backlog) with a single tab that
 * covers both a filterable table AND the spatial Risk Map view via a
 * table/map toggle (see view-toggle.tsx), plus the "Import Projects"
 * action (previously its own nav item in Phase 9, then a header button in
 * Phase 11) now living directly in this tab, since importing new PPA data
 * is specific to this tab's content, not a portal-wide action.
 *
 * Filtering is implemented via URL search params in both views so the
 * filtered result is shareable/bookmarkable and every fetch stays a plain
 * Server Component query — no client-side data-fetching library needed.
 * The actual filter-application logic lives in filters.ts, shared with
 * export/route.ts so the CSV export can never disagree with what's on
 * screen.
 *
 * Phase 16: table/map toggle moved up next to "Import Projects"; Project
 * Type and Municipality added as filters; Export and Toggle Columns
 * controls added to the table toolbar (see data-table.tsx).
 * Phase 17: every facet became multi-select (see filters.ts's `.in()`
 * logic), and Budget/Risk Probability range-slider filters were added
 * (see ppa-filter-sidebar.tsx) -- their bounds come from live MIN/MAX
 * queries below rather than guessed constants.
 * Phase 18: sidebar sections reordered (Status, Risk Tier, Project Type,
 * Municipality, Budget, Risk Probability) with a Reset link; a removable-
 * chip active-filters summary (ppa-active-filters.tsx) now sits above the
 * table/map card, visible in both views since filters apply to both.
 * Phase 19: the Map view's card gets its own search bar (ppa-search-bar.tsx,
 * shared with the table toolbar) -- previously only the table view had one.
 * "Import Projects" is now a slide-out panel (ppa-import-panel.tsx) instead
 * of a Link to /manager/import, so importing no longer navigates away from
 * whatever filters/page/view the Manager was looking at.
 */
export default async function PpasPage({ searchParams }: PpasPageProps) {
  const params = await searchParams;
  const view: PpaView = params.view === "map" ? "map" : "table";
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const supabase = await createClient();

  // Distinct municipality values for the sidebar's Municipality filter.
  // PostgREST has no SELECT DISTINCT -- this fetches the single
  // `municipality` column across every row (cheap: one short text column,
  // no joins, no pagination limit applied to this query specifically) and
  // dedupes/sorts in memory instead.
  const { data: municipalityRows } = await supabase
    .from("projects")
    .select("municipality")
    .not("municipality", "is", null);
  const municipalities = Array.from(
    new Set((municipalityRows ?? []).map((r) => r.municipality).filter((m): m is string => Boolean(m)))
  ).sort();

  // Live MIN/MAX bounds for the Budget range slider. PostgREST has no
  // aggregate MIN/MAX in a single .select() the way SQL does, so this is
  // two cheap order+limit(1) queries instead of scanning the whole table
  // client-side. Falls back to a 0-0 range (a disabled-looking, harmless
  // slider) if amount_php is null on every row.
  const [{ data: minRow }, { data: maxRow }] = await Promise.all([
    supabase
      .from("projects")
      .select("amount_php")
      .not("amount_php", "is", null)
      .order("amount_php", { ascending: true })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("projects")
      .select("amount_php")
      .not("amount_php", "is", null)
      .order("amount_php", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  const revenueBounds = {
    min: Math.floor(minRow?.amount_php ?? 0),
    max: Math.ceil(maxRow?.amount_php ?? 0),
  };

  let query = supabase
    .from("projects")
    .select(
      "id, project_key, name_of_project, municipality, status, risk_tier, risk_probability, latitude, longitude",
      { count: "exact" }
    )
    .order("risk_probability", { ascending: false, nullsFirst: false });

  query = applyPpaFilters(query, params, municipalities);

  const from = (page - 1) * PAGE_SIZE;
  query = view === "map" ? query.limit(MAP_MARKER_LIMIT) : query.range(from, from + PAGE_SIZE - 1);

  const { data: projects, error, count } = await query;
  const totalCount = count ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  const tableParams = {
    q: params.q,
    risk_tier: params.risk_tier,
    status: params.status,
    project_type: params.project_type,
    municipality: params.municipality,
    revenue_min: params.revenue_min,
    revenue_max: params.revenue_max,
    risk_min: params.risk_min,
    risk_max: params.risk_max,
    view: params.view,
  };
  const exportHref = `/manager/ppas/export?${new URLSearchParams(
    Object.entries(tableParams).filter(([key, v]) => Boolean(v) && key !== "view") as [string, string][]
  ).toString()}`;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-brand-navy">
            Program, Projects, and Activities (PPAs)
          </h1>
          <p className="text-sm text-slate-500">
            Every tracked PPA, filterable by name, risk tier, status, project type, municipality,
            budget, and risk probability — as a table or on the map.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <ViewToggle current={view} />
          <PpaImportPanel />
        </div>
      </div>

      <div className="flex flex-col gap-6 lg:flex-row lg:items-stretch">
        <PpaFilterSidebar
          riskTiers={RISK_TIERS}
          statuses={STATUSES}
          projectTypes={PROJECT_TYPES}
          municipalities={municipalities}
          revenueBounds={revenueBounds}
        />

        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <PpaActiveFilters />

          {view === "table" ? (
            <Card className="border-brand-navy/10 p-0">
              <CardContent className="p-0">
                {error && <p className="p-5 text-sm text-red-600">{error.message}</p>}
                <PpasDataTable
                  columns={ppaColumns}
                  data={projects ?? []}
                  page={page}
                  totalPages={totalPages}
                  totalCount={totalCount}
                  pageSize={PAGE_SIZE}
                  params={tableParams}
                  exportHref={exportHref}
                />
              </CardContent>
            </Card>
          ) : (
            <Card className="p-0">
              <div className="border-b border-brand-navy/10 px-5 py-3">
                <PpaSearchBar />
              </div>
              <CardHeader>
                <CardTitle>
                  {(projects ?? []).length} project(s) on the map
                  {totalCount > MAP_MARKER_LIMIT && ` (top ${MAP_MARKER_LIMIT} of ${totalCount} by risk)`}
                </CardTitle>
                <CardDescription>
                  Same filters as the sidebar, plotted spatially. Green = Low &middot; Yellow =
                  Medium &middot; Orange = High &middot; Red = Critical. Pins cluster at
                  province-wide zoom levels.
                  {totalCount > MAP_MARKER_LIMIT &&
                    ` Showing the ${MAP_MARKER_LIMIT} riskiest matches only -- narrow the filters to see the rest.`}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {error && <p className="text-sm text-red-600">{error.message}</p>}
                <MapLoader projects={(projects as MapProject[]) ?? []} />
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
