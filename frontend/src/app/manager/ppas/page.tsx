import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { ProjectStatus, RiskTier } from "@/types/database";
import { PpaFilterSidebar } from "./ppa-filter-sidebar";
import { ViewToggle, type PpaView } from "./view-toggle";
import { MapLoader } from "../map/map-loader";
import type { MapProject } from "../map/types";
import { PpasDataTable } from "./data-table";
import { ppaColumns } from "./columns";

const RISK_TIERS = ["Critical", "High", "Medium", "Low"] as const;
const STATUSES = [
  { value: "not_yet_implemented", label: "Not Yet Implemented" },
  { value: "for_bidding", label: "For Bidding" },
  { value: "on_going", label: "On-going" },
  { value: "completed", label: "Completed" },
] as const;
const PROJECT_TYPES = ["Infrastructure", "Non-Infrastructure", "Unclassified"] as const;

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
  searchParams: Promise<{
    q?: string;
    risk_tier?: string;
    status?: string;
    project_type?: string;
    municipality?: string;
    view?: string;
    page?: string;
  }>;
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
 * Filtering (search/risk tier/status/project type/municipality) is
 * implemented via URL search params in both views so the filtered result
 * is shareable/bookmarkable and every fetch stays a plain Server Component
 * query — no client-side data-fetching library needed.
 *
 * Phase 16: table/map toggle moved up next to "Import Projects" (was its
 * own row below the filters); Project Type and Municipality added as
 * filters (see ppa-filter-sidebar.tsx); Export and Toggle Columns controls
 * added to the table toolbar (see data-table.tsx).
 */
export default async function PpasPage({ searchParams }: PpasPageProps) {
  const params = await searchParams;
  const view: PpaView = params.view === "map" ? "map" : "table";
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const supabase = await createClient();

  let query = supabase
    .from("projects")
    .select(
      "id, project_key, name_of_project, municipality, status, risk_tier, risk_probability, latitude, longitude",
      { count: "exact" }
    )
    .order("risk_probability", { ascending: false, nullsFirst: false });

  if (params.q) {
    query = query.ilike("name_of_project", `%${params.q}%`);
  }
  // Narrow the raw URL search params (plain strings) to the actual union
  // types the risk_tier/status columns use — .eq() is typed against the
  // column, so a bare string (even one that's always valid in practice,
  // since it only ever comes from the sidebar's own options) won't
  // type-check without this. Invalid/stale query params are simply
  // ignored rather than erroring the page.
  if (params.risk_tier && (RISK_TIERS as readonly string[]).includes(params.risk_tier)) {
    query = query.eq("risk_tier", params.risk_tier as RiskTier);
  }
  if (params.status && STATUSES.some((s) => s.value === params.status)) {
    query = query.eq("status", params.status as ProjectStatus);
  }
  if (params.project_type && (PROJECT_TYPES as readonly string[]).includes(params.project_type)) {
    query = query.eq(
      "project_type",
      params.project_type as "Infrastructure" | "Non-Infrastructure" | "Unclassified"
    );
  }
  const from = (page - 1) * PAGE_SIZE;

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

  // Municipality isn't a fixed enum like the others -- validated against
  // the live `municipalities` list above instead of a hardcoded union, so
  // it can never reject a real value that's actually in the database.
  if (params.municipality && municipalities.includes(params.municipality)) {
    query = query.eq("municipality", params.municipality);
  }

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
            Every tracked PPA, filterable by name, risk tier, status, project type, and
            municipality — as a table or on the map.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <ViewToggle current={view} />
          <Button asChild>
            <Link href="/manager/import">Import Projects</Link>
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        <PpaFilterSidebar
          riskTiers={RISK_TIERS}
          statuses={STATUSES}
          projectTypes={PROJECT_TYPES}
          municipalities={municipalities}
        />

        <div className="min-w-0 flex-1">
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
            <Card>
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
