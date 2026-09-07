import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent } from "@/components/ui/card";
import { Badge, riskTierVariant } from "@/components/ui/badge";
import { ChevronRight, MapPin } from "lucide-react";
import { ProjectSearch } from "./project-search";

interface AssignedProjectsPageProps {
  searchParams: Promise<{ q?: string }>;
}

interface JoinedProject {
  id: string;
  project_key: string;
  name_of_project: string;
  location: string;
  municipality: string | null;
  risk_tier: string | null;
}

/**
 * Every project this Inspector is assigned to, not just today's route.
 *
 * The home screen used to ask "Need to file a report for a project not on
 * today's list?" in a card that offered no way to do it -- a dead end in
 * the one workflow this portal exists for. A visit can slip a day, or a
 * site can be passed on the way to another; the report still has to be
 * filable. RLS ("projects: inspectors read assigned") already scopes this
 * to their own assignments, so the query needs no extra guard.
 */
export default async function AssignedProjectsPage({ searchParams }: AssignedProjectsPageProps) {
  const { q } = await searchParams;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: rows } = await supabase
    .from("inspector_schedules")
    .select(
      "project:projects(id, project_key, name_of_project, location, municipality, risk_tier)"
    )
    .eq("inspector_id", user?.id ?? "");

  // One card per project, not per assignment: the same project scheduled
  // in two weeks should not appear twice in a list you pick from.
  const byId = new Map<string, JoinedProject>();
  for (const row of rows ?? []) {
    const project = row.project as unknown as JoinedProject | null;
    if (project) byId.set(project.id, project);
  }

  const query = (q ?? "").trim().toLowerCase();
  const projects = Array.from(byId.values())
    .filter(
      (p) =>
        !query ||
        p.name_of_project.toLowerCase().includes(query) ||
        (p.municipality ?? "").toLowerCase().includes(query)
    )
    .sort((a, b) => a.name_of_project.localeCompare(b.name_of_project));

  const caption = `${byId.size} project${byId.size === 1 ? "" : "s"} assigned to you`;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Link href="/inspector" className="text-xs text-slate-500 hover:underline">
          ← Today&apos;s route
        </Link>
        <h1 className="mt-1 text-xl font-semibold text-brand-navy">Your projects</h1>
        <p className="text-sm text-slate-500">{caption}</p>
      </div>

      {byId.size > 5 && <ProjectSearch />}

      <div className="flex flex-col gap-3">
        {projects.map((project) => (
          <Link key={project.id} href={`/inspector/report/${project.id}`}>
            <Card className="transition-shadow active:shadow-none">
              <CardContent className="flex items-center justify-between gap-3 py-4">
                <div className="min-w-0">
                  <p className="truncate font-medium text-slate-900">{project.name_of_project}</p>
                  <p className="mt-0.5 flex items-center gap-1 text-xs text-slate-500">
                    <MapPin className="size-3.5 shrink-0" />
                    <span className="truncate">{project.location}</span>
                  </p>
                  {project.risk_tier && (
                    <Badge variant={riskTierVariant(project.risk_tier)} className="mt-2">
                      {project.risk_tier}
                    </Badge>
                  )}
                </div>
                <ChevronRight className="size-5 shrink-0 text-slate-300" />
              </CardContent>
            </Card>
          </Link>
        ))}

        {projects.length === 0 && (
          <Card>
            <CardContent className="py-8 text-center text-sm text-slate-500">
              {byId.size === 0
                ? "You have no assigned projects yet."
                : "No assigned project matches that search."}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
