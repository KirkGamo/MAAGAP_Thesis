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

interface PpasPageProps {
  searchParams: Promise<{ q?: string; risk_tier?: string; status?: string; view?: string }>;
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
  const supabase = await createClient();

  let query = supabase
    .from("projects")
    .select(
      "id, project_key, name_of_project, municipality, status, risk_tier, risk_probability, latitude, longitude"
    )
    .order("risk_probability", { ascending: false, nullsFirst: false })
    .limit(200);

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

  const { data: projects, error } = await query;

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
            <CardTitle>{projects?.length ?? 0} project(s)</CardTitle>
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
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>{projects?.length ?? 0} project(s) on the map</CardTitle>
            <CardDescription>
              Same filters as the table view above, plotted spatially. Green = Low &middot; Yellow
              = Medium &middot; Orange = High &middot; Red = Critical. Pins cluster at province-wide
              zoom levels.
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
