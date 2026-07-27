import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, riskTierVariant } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface ProjectDetailPageProps {
  params: Promise<{ projectId: string }>;
}

const MONITORING_PHOTOS_BUCKET = "monitoring-photos";
const SIGNED_URL_TTL_SECONDS = 60 * 10; // 10 minutes: only needs to outlive one page render

/** Manager-facing detail view: project metadata plus every monitoring
 * report an Inspector has filed against it (the ML feedback loop's output —
 * see actions/submit-report.ts).
 *
 * `monitoring_reports.photo_urls` stores Supabase Storage *paths*, not
 * signed URLs (the `monitoring-photos` bucket is private — see
 * supabase/storage_monitoring_photos.sql) — a signed URL minted once at
 * upload time would expire a fixed number of days later regardless of when
 * a Manager actually opens this page. Instead, every render re-signs each
 * report's paths fresh, right here, server-side. */
export default async function ProjectDetailPage({ params }: ProjectDetailPageProps) {
  const { projectId } = await params;
  const supabase = await createClient();

  const { data: project } = await supabase
    .from("projects")
    .select("*")
    .eq("id", projectId)
    .single();

  if (!project) notFound();

  const { data: reportsRaw } = await supabase
    .from("monitoring_reports")
    .select("id, visited_at, status_observed, percent_complete, remarks, photo_urls")
    .eq("project_id", projectId)
    .order("visited_at", { ascending: false });

  // Re-sign every stored path in one batched call per report rather than
  // N individual createSignedUrl calls. RLS on storage.objects (see
  // storage_monitoring_photos.sql's "managers read all" policy) still
  // governs whether this Manager is allowed to read these paths at all --
  // signing doesn't bypass that.
  const reports = await Promise.all(
    (reportsRaw ?? []).map(async (r) => {
      const paths = r.photo_urls ?? [];
      if (paths.length === 0) return { ...r, signedPhotoUrls: [] as string[] };

      const { data: signed } = await supabase.storage
        .from(MONITORING_PHOTOS_BUCKET)
        .createSignedUrls(paths, SIGNED_URL_TTL_SECONDS);

      const signedPhotoUrls = (signed ?? [])
        .map((s) => s.signedUrl)
        .filter((url): url is string => Boolean(url));

      return { ...r, signedPhotoUrls };
    })
  );

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-brand-navy">{project.name_of_project}</h1>
        <p className="text-sm text-slate-500">
          {project.project_key} · {project.location}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Risk assessment</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center gap-4">
          {project.risk_tier ? (
            <Badge variant={riskTierVariant(project.risk_tier)}>{project.risk_tier}</Badge>
          ) : (
            <span className="text-sm text-slate-400">Not yet scored</span>
          )}
          {project.risk_probability != null && (
            <span className="text-sm text-slate-600">
              P(RedFlag) = {project.risk_probability.toFixed(3)}
            </span>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Monitoring reports ({reports?.length ?? 0})</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Visited</TableHead>
                <TableHead>Status observed</TableHead>
                <TableHead>% complete</TableHead>
                <TableHead>Remarks</TableHead>
                <TableHead>Photos</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(reports ?? []).map((r) => (
                <TableRow key={r.id}>
                  <TableCell>{new Date(r.visited_at).toLocaleDateString()}</TableCell>
                  <TableCell className="capitalize">{r.status_observed.replaceAll("_", " ")}</TableCell>
                  <TableCell>{r.percent_complete != null ? `${r.percent_complete}%` : "—"}</TableCell>
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
              ))}
              {(reports ?? []).length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-slate-400">
                    No field reports filed yet.
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
