import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { PpaFilterSidebar } from "./ppa-filter-sidebar";
import { PpaActiveFilters } from "./ppa-active-filters";
import { PpaSearchBar } from "./ppa-search-bar";
import {
  ControlsVisibilityProvider,
  ControlsRegion,
  PpaControlsToggle,
} from "./controls-visibility";
import { PpaImportPanel } from "./ppa-import-panel";
import { PageHeader } from "@/components/page-header";
import { ViewToggle, type PpaView } from "./view-toggle";
import { MapLoader } from "../map/map-loader";
import type { MapProject } from "../map/types";
import { PpasDataTable } from "./data-table";
import { ppaColumns } from "./columns";
import { RISK_TIERS, STATUSES, PROJECT_TYPES, applyPpaFilters, type PpaFilterParams } from "./filters";
import { FolderKanban } from "lucide-react";

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
      controls?: string;
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
 * Phase 20: the table/map Card and the filter sidebar all share one fixed
 * `lg:h-[700px]`, with `flex flex-col` + a `min-h-0 flex-1` content region
 * inside each so their (differently-shaped) real content fits/scrolls
 * within that budget instead of dictating it -- see ppa-filter-sidebar.tsx
 * for why this replaced an earlier flexbox-stretch approach that let an
 * expanded sidebar grow taller than its sibling.
 * Phase 21: a `controls` URL param (not a filter -- preserved the same way
 * `view` is) can hide PpaFilterSidebar entirely so the table/map can use
 * the full row width; see ppa-controls-toggle.tsx. Budget and Project
 * Type, already filterable, are now visible table columns too (see
 * columns.tsx) -- both were added to the `.select(...)` below.
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
  // Paginated deliberately. PostgREST caps an unbounded select at 1,000 rows,
  // so this query silently described only the first 1,000 of 2,393 projects --
  // which the municipality list has been built from since it was written, so
  // the Municipality filter has been missing every municipality that appears
  // only later in the table. The counts added alongside it made the truncation
  // visible: status and risk tier each summed to exactly 1,000.
  const FACET_PAGE = 1000;
  const facetRows: { municipality: string | null; status: string | null; risk_tier: string | null; project_type: string | null }[] = [];
  for (let offset = 0; ; offset += FACET_PAGE) {
    const { data } = await supabase
      .from("projects")
      .select("municipality, status, risk_tier, project_type")
      .range(offset, offset + FACET_PAGE - 1);
    if (!data?.length) break;
    facetRows.push(...data);
    if (data.length < FACET_PAGE) break;
  }

  const municipalities = Array.from(
    new Set(
      facetRows.map((r) => r.municipality).filter((m): m is string => Boolean(m))
    )
  ).sort();

  // Counts per facet value, so each filter option can say how many projects it
  // would match. Derived from the one query above rather than four COUNT round
  // trips: these are four short columns over the whole table, which is what the
  // municipality dedupe already cost.
  const facetCount = (key: "status" | "risk_tier" | "project_type" | "municipality") => {
    const counts = new Map<string, number>();
    for (const row of facetRows) {
      const value = row[key];
      if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    return counts;
  };
  const facetCounts = {
    status: facetCount("status"),
    risk_tier: facetCount("risk_tier"),
    project_type: facetCount("project_type"),
    municipality: facetCount("municipality"),
  };

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
      "id, project_key, name_of_project, municipality, status, risk_tier, risk_probability, amount_php, project_type, latitude, longitude, date_last_monitored",
      { count: "exact" }
    )
    .order("risk_probability", { ascending: false, nullsFirst: false });

  query = applyPpaFilters(query, params, municipalities);

  const from = (page - 1) * PAGE_SIZE;
  query = view === "map" ? query.limit(MAP_MARKER_LIMIT) : query.range(from, from + PAGE_SIZE - 1);

  const { data: projects, error, count } = await query;
  const totalCount = count ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  const controlsHidden = params.controls === "hidden";

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
    controls: params.controls,
  };
  const exportHref = `/manager/ppas/export?${new URLSearchParams(
    Object.entries(tableParams).filter(
      ([key, v]) => Boolean(v) && key !== "view" && key !== "controls"
    ) as [string, string][]
  ).toString()}`;

  return (
    // The sidebar's visibility is client state, not a server round-trip. See
    // controls-visibility.tsx: the param it used to push changed no data, but
    // cost a full re-render and three queries.
    <ControlsVisibilityProvider initiallyHidden={controlsHidden}>
    <div className="flex flex-col gap-6">
      {/* Stacks below sm. As a single non-wrapping flex row this put the
          2-item action group (261px) beside the title at every width, pushing
          the page 15px past a 390px viewport -- the one horizontal overflow
          the four-viewport sweep found. min-w-0 lets the title column shrink
          rather than hold its longest line. */}
      <PageHeader
        title="Program, Projects, and Activities (PPAs)"
        icon={FolderKanban}
        description="Every tracked PPA, filterable by name, risk tier, status, project type, municipality, budget, and risk probability — as a table or on the map."
        actions={
          <div className="flex items-center gap-3">
            <ViewToggle current={view} />
            <PpaImportPanel />
          </div>
        }
      />

      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        <ControlsRegion>
          <PpaFilterSidebar
            riskTiers={RISK_TIERS}
            statuses={STATUSES}
            projectTypes={PROJECT_TYPES}
            municipalities={municipalities}
            counts={{
              status: Object.fromEntries(facetCounts.status),
              risk_tier: Object.fromEntries(facetCounts.risk_tier),
              project_type: Object.fromEntries(facetCounts.project_type),
              municipality: Object.fromEntries(facetCounts.municipality),
            }}
            revenueBounds={revenueBounds}
          />
        </ControlsRegion>

        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <PpaActiveFilters />

          {view === "table" ? (
            <Card className="flex flex-col overflow-hidden border-brand-navy/10 p-0 lg:h-[700px]">
              <CardContent className="flex min-h-0 flex-1 flex-col p-0">
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
            <Card className="flex flex-col overflow-hidden p-0 lg:h-[700px]">
              <div className="flex shrink-0 items-center gap-3 border-b border-brand-navy/10 px-5 py-3">
                <PpaControlsToggle />
                <PpaSearchBar />
              </div>
              <CardHeader className="shrink-0">
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
              <CardContent className="flex min-h-0 flex-1 flex-col">
                {error && <p className="text-sm text-red-600">{error.message}</p>}
                <MapLoader projects={(projects as MapProject[]) ?? []} />
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
    </ControlsVisibilityProvider>
  );
}
