import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, riskTierVariant } from "@/components/ui/badge";
import type { ProjectStatus, RiskTier } from "@/types/database";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { BacklogFilters } from "./backlog-filters";

const RISK_TIERS = ["Critical", "High", "Medium", "Low"] as const;
const STATUSES = [
  { value: "not_yet_implemented", label: "Not Yet Implemented" },
  { value: "for_bidding", label: "For Bidding" },
  { value: "on_going", label: "On-going" },
  { value: "completed", label: "Completed" },
] as const;

interface BacklogPageProps {
  searchParams: Promise<{ q?: string; risk_tier?: string; status?: string }>;
}

/**
 * Modular, filterable backlog table. Filtering is implemented via URL
 * search params rather than client-side state so the filtered view is
 * shareable/bookmarkable and the query itself stays a plain Server
 * Component data fetch — no client-side data-fetching library required for
 * what is fundamentally a server-rendered, filtered list.
 */
export default async function BacklogPage({ searchParams }: BacklogPageProps) {
  const params = await searchParams;
  const supabase = await createClient();

  let query = supabase
    .from("projects")
    .select("id, project_key, name_of_project, municipality, status, risk_tier, risk_probability")
    .order("risk_probability", { ascending: false, nullsFirst: false })
    .limit(200);

  if (params.q) {
    query = query.ilike("name_of_project", `%${params.q}%`);
  }
  // Narrow the raw URL search params (plain strings) to the actual union
  // types the risk_tier/status columns use — .eq() is typed against the
  // column, so a bare string (even one that's always valid in practice,
  // since it only ever comes from BacklogFilters' own <select> options)
  // won't type-check without this. Invalid/stale query params are simply
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
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Backlog</h1>
        <p className="text-sm text-slate-500">
          Every tracked project, filterable by name, risk tier, and status.
        </p>
      </div>

      <BacklogFilters riskTiers={RISK_TIERS} statuses={STATUSES} />

      <Card>
        <CardHeader>
          <CardTitle>{projects?.length ?? 0} project(s)</CardTitle>
        </CardHeader>
        <CardContent>
          {error && <p className="text-sm text-red-600">{error.message}</p>}
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
                      href={`/manager/backlog/${p.id}`}
                      className="font-medium text-slate-900 hover:underline"
                    >
                      {p.name_of_project}
                    </Link>
                    <div className="text-xs text-slate-400">{p.project_key}</div>
                  </TableCell>
                  <TableCell>{p.municipality ?? "—"}</TableCell>
                  <TableCell className="capitalize">{p.status?.replaceAll("_", " ")}</TableCell>
                  <TableCell>
                    {p.risk_tier ? (
                      <Badge variant={riskTierVariant(p.risk_tier)}>{p.risk_tier}</Badge>
                    ) : (
                      <span className="text-slate-400">Unscored</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {p.risk_probability != null ? p.risk_probability.toFixed(2) : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
