import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DeployScheduleButton } from "./deploy-schedule-button";
import { ScheduleMapLoader } from "./schedule-map-loader";
import { DayFilter } from "./day-filter";
import { ScheduleEditor } from "./schedule-editor";
import { ScheduleBoard, type BoardAssignment } from "./schedule-board";
import type { ScheduleMapPoint } from "./schedule-map";

const DAY_ORDER = ["Mon", "Tue", "Wed", "Thu", "Fri"] as const;

// Distinct per-inspector palette, deliberately separate from the risk-tier
// palette used everywhere else (Badge, Tracker, Risk Map) -- this map
// answers "which inspector is going where", a different question from
// "how risky is this project", so reusing red/amber/emerald here would
// wrongly suggest a risk-tier meaning that isn't there.
const INSPECTOR_COLORS = [
  "#4f46e5", // indigo-600
  "#0d9488", // teal-600
  "#7c3aed", // violet-600
  "#ea580c", // orange-600
  "#0891b2", // cyan-600
  "#a16207", // yellow-700
  "#be185d", // pink-700
  "#4d7c0f", // lime-700
];

interface SchedulePageProps {
  searchParams: Promise<{ day?: string }>;
}

/**
 * Displays the current week's inspector deployment schedule — the direct
 * output of `ml-service/optimization_engine.py`'s PuLP solve, mirrored into
 * `inspector_schedules` (see supabase/schema.sql). Grouped by inspector so
 * a Manager can see each person's week at a glance; each Inspector's own
 * portal (/inspector) shows the same data filtered to just themselves.
 *
 * Phase 12 adds a map view above the existing per-inspector card list --
 * the "map + list combo" chosen over a node-link graph (routing/schedule
 * data is fundamentally geographic + temporal, not a network of
 * relationships) or a map-free timeline (which would lose the "where are
 * they actually going" context that matters for routing/optimization
 * credibility). See schedule-map.tsx's docstring for more.
 */
export default async function SchedulePage({ searchParams }: SchedulePageProps) {
  const { day } = await searchParams;
  const selectedDay = day && (DAY_ORDER as readonly string[]).includes(day) ? day : "All";
  const supabase = await createClient();

  const { data: rows } = await supabase
    .from("inspector_schedules")
    .select(
      "id, inspector_id, scheduled_day, week_of, cluster, inspector:profiles!inspector_schedules_inspector_id_fkey(full_name), project:projects(project_key, name_of_project, municipality, risk_tier, latitude, longitude)"
    )
    .order("scheduled_day");

  // For the "reassign inspector" <select> and the "add assignment" form --
  // only active inspectors are offered, matching the Inspectors tab's own
  // active/inactive gate (an inactive inspector can't log in, so assigning
  // them work would be pointless).
  const { data: activeInspectors } = await supabase
    .from("profiles")
    .select("id, full_name")
    .eq("role", "inspector")
    .eq("active", true)
    .order("full_name");

  const byInspector = new Map<string, typeof rows>();
  for (const row of rows ?? []) {
    const name = (row.inspector as unknown as { full_name: string | null })?.full_name ?? "Unassigned";
    if (!byInspector.has(name)) byInspector.set(name, []);
    byInspector.get(name)!.push(row);
  }

  // Stable color assignment: sort inspector names first so the same
  // inspector gets the same color across renders/day-filter changes,
  // rather than depending on Supabase's row-return order.
  const inspectorNames = Array.from(byInspector.keys()).sort();
  const colorByInspector = new Map(
    inspectorNames.map((name, i) => [name, INSPECTOR_COLORS[i % INSPECTOR_COLORS.length]])
  );

  const mapPoints: ScheduleMapPoint[] = (rows ?? [])
    .filter((row) => selectedDay === "All" || row.scheduled_day === selectedDay)
    .map((row) => {
      const inspectorName =
        (row.inspector as unknown as { full_name: string | null })?.full_name ?? "Unassigned";
      const project = row.project as unknown as {
        project_key: string;
        name_of_project: string;
        municipality: string | null;
        latitude: number | null;
        longitude: number | null;
      } | null;
      return {
        id: row.id,
        inspectorName,
        projectName: project?.name_of_project ?? "Unknown project",
        municipality: project?.municipality ?? null,
        latitude: project?.latitude ?? null,
        longitude: project?.longitude ?? null,
        day: row.scheduled_day,
        color: colorByInspector.get(inspectorName) ?? INSPECTOR_COLORS[0],
      };
    });

  const editableAssignments = (rows ?? []).map((row) => {
    const project = row.project as unknown as {
      project_key: string;
      name_of_project: string;
    } | null;
    return {
      id: row.id,
      projectKey: project?.project_key ?? "unknown",
      projectName: project?.name_of_project ?? "Unknown project",
      inspectorId: row.inspector_id,
      scheduledDay: row.scheduled_day,
      cluster: row.cluster,
    };
  });

  // Phase 13: day -> inspector -> assignments, for the Kanban-style
  // ScheduleBoard below (replaces the old inspector-first grid). Built
  // straight from the same `rows` query the map/editor already use, so
  // there's exactly one source of truth for "what's scheduled this week".
  const boardByDay: Record<string, Record<string, BoardAssignment[]>> = {};
  for (const dayOfWeek of DAY_ORDER) boardByDay[dayOfWeek] = {};
  for (const row of rows ?? []) {
    const inspectorName =
      (row.inspector as unknown as { full_name: string | null })?.full_name ?? "Unassigned";
    const project = row.project as unknown as {
      name_of_project: string;
      municipality: string | null;
      risk_tier: string | null;
    } | null;
    const day = row.scheduled_day;
    if (!boardByDay[day]) boardByDay[day] = {}; // guards against an unexpected day value
    if (!boardByDay[day][inspectorName]) boardByDay[day][inspectorName] = [];
    boardByDay[day][inspectorName].push({
      id: row.id,
      projectName: project?.name_of_project ?? "Unknown project",
      municipality: project?.municipality ?? null,
      riskTier: project?.risk_tier ?? null,
      cluster: row.cluster,
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-brand-navy">Schedule</h1>
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
              output here — or add assignments manually below.
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Adjust this week&apos;s schedule</CardTitle>
          <CardDescription>
            Not happy with the optimizer&apos;s result? Reassign an inspector or day, remove an
            assignment, or add one manually.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ScheduleEditor assignments={editableAssignments} inspectors={activeInspectors ?? []} />
        </CardContent>
      </Card>

      {byInspector.size > 0 && (
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle>Routing map</CardTitle>
                <CardDescription>
                  Each inspector&apos;s assigned sites, color-coded per inspector.
                </CardDescription>
              </div>
              <DayFilter current={selectedDay} />
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <ScheduleMapLoader points={mapPoints} />
            <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-slate-500">
              {inspectorNames.map((name) => (
                <span key={name} className="flex items-center gap-1.5">
                  <span
                    className="inline-block size-3 rounded-full border border-white"
                    style={{ background: colorByInspector.get(name) }}
                  />
                  {name}
                </span>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <ScheduleBoard days={DAY_ORDER} boardByDay={boardByDay} colorByInspector={colorByInspector} />
    </div>
  );
}
