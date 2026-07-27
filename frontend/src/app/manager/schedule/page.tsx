import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, riskTierVariant } from "@/components/ui/badge";
import { DeployScheduleButton } from "./deploy-schedule-button";

const DAY_ORDER = ["Mon", "Tue", "Wed", "Thu", "Fri"] as const;

/**
 * Displays the current week's inspector deployment schedule — the direct
 * output of `ml-service/optimization_engine.py`'s PuLP solve, mirrored into
 * `inspector_schedules` (see supabase/schema.sql). Grouped by inspector so
 * a Manager can see each person's week at a glance; each Inspector's own
 * portal (/inspector) shows the same data filtered to just themselves.
 */
export default async function SchedulePage() {
  const supabase = await createClient();

  const { data: rows } = await supabase
    .from("inspector_schedules")
    .select(
      "id, scheduled_day, week_of, cluster, inspector:profiles!inspector_schedules_inspector_id_fkey(full_name), project:projects(project_key, name_of_project, municipality, risk_tier)"
    )
    .order("scheduled_day");

  const byInspector = new Map<string, typeof rows>();
  for (const row of rows ?? []) {
    const name = (row.inspector as unknown as { full_name: string | null })?.full_name ?? "Unassigned";
    if (!byInspector.has(name)) byInspector.set(name, []);
    byInspector.get(name)!.push(row);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Schedule</h1>
          <p className="text-sm text-slate-500">
            This week&apos;s PuLP-optimized inspector deployment.
          </p>
        </div>
        <DeployScheduleButton />
      </div>

      {byInspector.size === 0 && (
        <Card>
          <CardHeader>
            <CardTitle>No schedule deployed yet</CardTitle>
            <CardDescription>
              Run <code>ml-service/optimization_engine.py</code> and click{" "}
              <span className="font-medium">Deploy latest schedule</span> to publish its
              output here.
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {Array.from(byInspector.entries()).map(([inspectorName, assignments]) => (
          <Card key={inspectorName}>
            <CardHeader>
              <CardTitle className="text-base">{inspectorName}</CardTitle>
              <CardDescription>{assignments!.length} site visit(s) this week</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {DAY_ORDER.map((day) => {
                const dayAssignments = assignments!.filter((a) => a.scheduled_day === day);
                if (dayAssignments.length === 0) return null;
                return (
                  <div key={day}>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                      {day}
                    </p>
                    <ul className="mt-1 flex flex-col gap-1.5">
                      {dayAssignments.map((a) => {
                        const project = a.project as unknown as {
                          project_key: string;
                          name_of_project: string;
                          municipality: string | null;
                          risk_tier: string | null;
                        } | null;
                        return (
                          <li key={a.id} className="rounded-md border border-slate-100 p-2 text-sm">
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-medium text-slate-800">
                                {project?.name_of_project ?? "Unknown project"}
                              </span>
                              {project?.risk_tier && (
                                <Badge variant={riskTierVariant(project.risk_tier)}>
                                  {project.risk_tier}
                                </Badge>
                              )}
                            </div>
                            <p className="text-xs text-slate-400">
                              {project?.municipality} · {a.cluster}
                            </p>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
