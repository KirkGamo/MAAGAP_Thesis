import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ReportForm } from "./report-form";

interface ReportPageProps {
  params: Promise<{ projectId: string }>;
}

export default async function SubmitReportPage({ params }: ReportPageProps) {
  const { projectId } = await params;
  const supabase = await createClient();

  const { data: project } = await supabase
    .from("projects")
    .select("id, project_key, name_of_project, location")
    .eq("id", projectId)
    .single();

  if (!project) notFound();

  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
          {project.project_key}
        </p>
        <h1 className="text-xl font-semibold text-slate-900">{project.name_of_project}</h1>
        <p className="text-sm text-slate-500">{project.location}</p>
      </div>

      <Card>
        <CardHeader className="py-3">
          <CardTitle className="text-base">File monitoring report</CardTitle>
        </CardHeader>
        <CardContent>
          <ReportForm projectId={project.id} />
        </CardContent>
      </Card>
    </div>
  );
}
