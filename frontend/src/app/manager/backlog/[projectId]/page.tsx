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

/** Manager-facing detail view: project metadata plus every monitoring
 * report an Inspector has filed against it (the ML feedback loop's output —
 * see actions/submit-report.ts). */
export default async function ProjectDetailPage({ params }: ProjectDetailPageProps) {
  const { projectId } = await params;
  const supabase = await createClient();

  const { data: project } = await supabase
    .from("projects")
    .select("*")
    .eq("id", projectId)
    .single();

  if (!project) notFound();

  const { data: reports } = await supabase
    .from("monitoring_reports")
    .select("id, visited_at, status_observed, percent_complete, remarks")
    .eq("project_id", projectId)
    .order("visited_at", { ascending: false });

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
              </TableRow>
            </TableHeader>
            <TableBody>
              {(reports ?? []).map((r) => (
                <TableRow key={r.id}>
                  <TableCell>{new Date(r.visited_at).toLocaleDateString()}</TableCell>
                  <TableCell className="capitalize">{r.status_observed.replaceAll("_", " ")}</TableCell>
                  <TableCell>{r.percent_complete != null ? `${r.percent_complete}%` : "—"}</TableCell>
                  <TableCell className="max-w-xs truncate">{r.remarks ?? "—"}</TableCell>
                </TableRow>
              ))}
              {(reports ?? []).length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-slate-400">
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
