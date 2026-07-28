import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ReportsFilters } from "./reports-filters";

const MONITORING_PHOTOS_BUCKET = "monitoring-photos";
const SIGNED_URL_TTL_SECONDS = 60 * 10; // 10 minutes: only needs to outlive one page render
const MAX_ROWS = 200;

interface ReportsPageProps {
  searchParams: Promise<{ q?: string; inspector?: string }>;
}

/**
 * Phase 12: Reports tab — a full audit trail of every monitoring_reports
 * row ever filed (the ML feedback loop's raw input; see
 * actions/submit-report.ts), across every project, rather than the
 * per-project slice already shown on each PPA's detail page
 * (app/manager/ppas/[projectId]/page.tsx). Useful at a defense to show the
 * complete field-verification trail behind the risk scores, not just the
 * scores themselves.
 *
 * Filtering (project name search, inspector) via URL search params, same
 * pattern as every other filterable list in this portal.
 */
export default async function ReportsPage({ searchParams }: ReportsPageProps) {
  const params = await searchParams;
  const supabase = await createClient();

  const { data: inspectors } = await supabase
    .from("profiles")
    .select("id, full_name")
    .eq("role", "inspector")
    .order("full_name");

  let query = supabase
    .from("monitoring_reports")
    .select(
      "id, visited_at, status_observed, percent_complete, remarks, photo_urls, project:projects(id, name_of_project, project_key), inspector:profiles!monitoring_reports_inspector_id_fkey(full_name)"
    )
    .order("visited_at", { ascending: false })
    .limit(MAX_ROWS);

  if (params.inspector) {
    query = query.eq("inspector_id", params.inspector);
  }

  const { data: reportsRaw, error } = await query;

  // Project-name search happens client-... no, server-side, but the
  // column being searched (project.name_of_project) lives on a joined
  // table, which PostgREST's .ilike() can't filter across directly in one
  // query alongside the join syntax used here -- filtered in memory
  // instead, same tradeoff .not("risk_tier", ...) elsewhere in this app
  // makes for joined/derived fields. MAX_ROWS caps this to a bounded scan.
  const filtered = (reportsRaw ?? []).filter((r) => {
    if (!params.q) return true;
    const project = r.project as unknown as { name_of_project: string } | null;
    return project?.name_of_project.toLowerCase().includes(params.q!.toLowerCase());
  });

  const reports = await Promise.all(
    filtered.map(async (r) => {
      const paths = r.photo_urls ?? [];
      let signedPhotoUrls: string[] = [];
      if (paths.length > 0) {
        const { data: signed } = await supabase.storage
          .from(MONITORING_PHOTOS_BUCKET)
          .createSignedUrls(paths, SIGNED_URL_TTL_SECONDS);
        signedPhotoUrls = (signed ?? [])
          .map((s) => s.signedUrl)
          .filter((url): url is string => Boolean(url));
      }
      return { ...r, signedPhotoUrls };
    })
  );

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-brand-navy">Reports</h1>
        <p className="text-sm text-slate-500">
          Every field monitoring report ever filed, across all PPAs — the audit trail behind the
          ML feedback loop.
        </p>
      </div>

      <ReportsFilters inspectors={inspectors ?? []} />

      <Card className="border-brand-navy/10 p-0">
        <CardHeader className="border-b border-brand-navy/10 px-5 py-4">
          <CardTitle>{reports.length} report(s){reports.length === MAX_ROWS ? " (showing most recent)" : ""}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {error && <p className="p-5 text-sm text-red-600">{error.message}</p>}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Visited</TableHead>
                <TableHead>Inspector</TableHead>
                <TableHead>Project</TableHead>
                <TableHead>Status observed</TableHead>
                <TableHead>% complete</TableHead>
                <TableHead>Remarks</TableHead>
                <TableHead>Photos</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {reports.map((r) => {
                const project = r.project as unknown as {
                  id: string;
                  name_of_project: string;
                  project_key: string;
                } | null;
                const inspector = r.inspector as unknown as { full_name: string | null } | null;
                return (
                  <TableRow key={r.id}>
                    <TableCell>{new Date(r.visited_at).toLocaleString()}</TableCell>
                    <TableCell>{inspector?.full_name ?? "Unknown"}</TableCell>
                    <TableCell>
                      {project ? (
                        <Link
                          href={`/manager/ppas/${project.id}`}
                          className="font-medium text-slate-900 hover:underline"
                        >
                          {project.name_of_project}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell className="capitalize">
                      {r.status_observed.replaceAll("_", " ")}
                    </TableCell>
                    <TableCell>
                      {r.percent_complete != null ? `${r.percent_complete}%` : "—"}
                    </TableCell>
                    <TableCell className="max-w-xs truncate">{r.remarks ?? "—"}</TableCell>
                    <TableCell>
                      {r.signedPhotoUrls.length > 0 ? (
                        <div className="flex gap-1.5">
                          {r.signedPhotoUrls.map((url, i) => (
                            <a key={i} href={url} target="_blank" rel="noopener noreferrer">
                              {/* eslint-disable-next-line @next/next/no-img-element -- freshly-signed remote URL from Supabase Storage, not a static/local asset next/image can optimize */}
                              <img
                                src={url}
                                alt={`Site photo ${i + 1}`}
                                className="size-10 rounded border border-brand-navy/10 object-cover"
                              />
                            </a>
                          ))}
                        </div>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
              {reports.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-slate-400">
                    No monitoring reports match this filter.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
