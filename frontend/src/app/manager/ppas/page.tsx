import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge, riskTierVariant, statusVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ProjectStatus, RiskTier } from "@/types/database";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PpaFilters } from "./ppa-filters";
import { ViewToggle, type PpaView } from "./view-toggle";
import { MapLoader } from "../map/map-loader";
import type { MapProject } from "../map/types";

const RISK_TIERS = ["Critical", "High", "Medium", "Low"] as const;
const STATUSES = [
  { value: "not_yet_implemented", label: "Not Yet Implemented" },
  { value: "for_bidding", label: "For Bidding" },
  { value: "on_going", label: "On-going" },
  { value: "completed", label: "Completed" },
] as const;

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
 * Filtering (search/risk tier/status) is implemented via URL search
 * params in both views so the filtered result is shareable/bookmarkable
 * and every fetch stays a plain Server Component query — no client-side
 * data-fetching library needed.
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
  // since it only ever comes from PpaFilters' own <select> options) won't
  // type-check without this. Invalid/stale query params are simply
  // ignored rather than erroring the page.
  if (params.risk_tier && (RISK_TIERS as readonly string[]).includes(params.risk_tier)) {
    query = query.eq("risk_tier", params.risk_tier as RiskTier);
  }
  if (params.status && STATUSES.some((s) => s.value === params.status)) {
    query = query.eq("status", params.status as ProjectStatus);
  }

  const from = (page - 1) * PAGE_SIZE;
  query = view === "map" ? query.limit(MAP_MARKER_LIMIT) : query.range(from, from + PAGE_SIZE - 1);

  const { data: projects, error, count } = await query;
  const totalCount = count ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  // Preserves every other filter/view param, only ever changing `page` --
  // same "rewrite the URL" approach as ppa-filters.tsx/view-toggle.tsx, but
  // built as plain hrefs here since Prev/Next needs no client state.
  function pageHref(targetPage: number): string {
    const next = new URLSearchParams();
    if (params.q) next.set("q", params.q);
    if (params.risk_tier) next.set("risk_tier", params.risk_tier);
    if (params.status) next.set("status", params.status);
    if (params.view) next.set("view", params.view);
    if (targetPage > 1) next.set("page", String(targetPage));
    const qs = next.toString();
    return qs ? `/manager/ppas?${qs}` : "/manager/ppas";
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-brand-navy">
            Program, Projects, and Activities (PPAs)
          </h1>
          <p className="text-sm text-slate-500">
            Every tracked PPA, filterable by name, risk tier, and status — as a table or on the map.
          </p>
        </div>
        <Button asChild>
          <Link href="/manager/import">Import Projects</Link>
        </Button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <PpaFilters riskTiers={RISK_TIERS} statuses={STATUSES} />
        <ViewToggle current={view} />
      </div>

      {view === "table" ? (
        <Card className="border-brand-navy/10 p-0">
          <CardHeader className="border-b border-brand-navy/10 px-5 py-4">
            <CardTitle>{totalCount} project(s)</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {error && <p className="p-5 text-sm text-red-600">{error.message}</p>}
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Project</TableHead>
                  <TableHead>Municipality</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Risk Tier</TableHead>
                  <TableHead>P(RedFlag)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(projects ?? []).map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>
                      <Link
                        href={`/manager/ppas/${p.id}`}
                        className="font-medium text-slate-900 hover:underline"
                      >
                        {p.name_of_project}
                      </Link>
                      <div className="text-xs text-slate-400">{p.project_key}</div>
                    </TableCell>
                    <TableCell>{p.municipality ?? "—"}</TableCell>
                    <TableCell>
                      {p.status ? (
                        <Badge variant={statusVariant(p.status)}>
                          {STATUSES.find((s) => s.value === p.status)?.label ?? p.status}
                        </Badge>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell>
                      {p.risk_tier ? (
                        <Badge variant={riskTierVariant(p.risk_tier)}>{p.risk_tier}</Badge>
                      ) : (
                        <span className="text-slate-400">Unscored</span>
                      )}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {p.risk_probability != null ? `${(p.risk_probability * 100).toFixed(1)}%` : "—"}
                    </TableCell>
                  </TableRow>
                ))}
                {(projects ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="p-5 text-center text-slate-400">
                      No projects match the current filters.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
          {totalCount > 0 && (
            <div className="flex items-center justify-between border-t border-brand-navy/10 px-5 py-3 text-sm text-slate-500">
              <span>
                Showing {from + 1}–{Math.min(from + PAGE_SIZE, totalCount)} of {totalCount}
              </span>
              <div className="flex items-center gap-2">
                <Button asChild variant="outline" size="sm">
                  <Link
                    href={pageHref(page - 1)}
                    aria-disabled={page <= 1}
                    tabIndex={page <= 1 ? -1 : undefined}
                    className={page <= 1 ? "pointer-events-none opacity-50" : undefined}
                  >
                    Previous
                  </Link>
                </Button>
                <span className="tabular-nums">
                  Page {page} of {totalPages}
                </span>
                <Button asChild variant="outline" size="sm">
                  <Link
                    href={pageHref(page + 1)}
                    aria-disabled={page >= totalPages}
                    tabIndex={page >= totalPages ? -1 : undefined}
                    className={page >= totalPages ? "pointer-events-none opacity-50" : undefined}
                  >
                    Next
                  </Link>
                </Button>
              </div>
            </div>
          )}
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>
              {(projects ?? []).length} project(s) on the map
              {totalCount > MAP_MARKER_LIMIT && ` (top ${MAP_MARKER_LIMIT} of ${totalCount} by risk)`}
            </CardTitle>
            <CardDescription>
              Same filters as the table view above, plotted spatially. Green = Low &middot; Yellow
              = Medium &middot; Orange = High &middot; Red = Critical. Pins cluster at province-wide
              zoom levels.
              {totalCount > MAP_MARKER_LIMIT &&
                ` Showing the ${MAP_MARKER_LIMIT} riskiest matches only -- narrow the filters above to see the rest.`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {error && <p className="text-sm text-red-600">{error.message}</p>}
            <MapLoader projects={(projects as MapProject[]) ?? []} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
