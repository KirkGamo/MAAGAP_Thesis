import { createClient } from "@/lib/supabase/server";
import { currentWeekMonday } from "@/lib/current-week";
import { Card } from "@/components/tremor/card";
import { DeployScheduleButton } from "./deploy-schedule-button";
import { ScheduleMapLoader } from "./schedule-map-loader";
import { DayStrip, type DayTabInfo } from "./day-strip";
import { Scorecard, type OptimizerSummary } from "./scorecard";
import { WeekMatrix, type WeekMatrixRow } from "./week-matrix";
import { AgendaPane, type AgendaGroup } from "./agenda-pane";
import type { ScheduleMapPoint } from "./schedule-map";

const DAY_ORDER = ["Mon", "Tue", "Wed", "Thu", "Fri"] as const;

const DAY_FULL_NAMES: Record<string, string> = {
  Mon: "Monday",
  Tue: "Tuesday",
  Wed: "Wednesday",
  Thu: "Thursday",
  Fri: "Friday",
};

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

interface JoinedInspector {
  full_name: string | null;
}

interface JoinedProject {
  project_key: string;
  name_of_project: string;
  municipality: string | null;
  risk_tier: string | null;
  latitude: number | null;
  longitude: number | null;
}

/**
 * The optimizer scorecard's data. Best-effort by design: the ML service
 * is a separate process (often not running at all next to a deployed
 * frontend), so an unreachable/slow/errored fetch degrades to null and
 * the Scorecard explains itself -- the schedule workspace must render
 * fully from Supabase alone.
 */
async function fetchOptimizerSummary(): Promise<OptimizerSummary | null> {
  const baseUrl = process.env.FASTAPI_ML_SERVICE_URL;
  if (!baseUrl) return null;
  try {
    const res = await fetch(`${baseUrl}/api/v1/latest-schedule`, {
      cache: "no-store",
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { summary?: OptimizerSummary | null };
    return data.summary ?? null;
  } catch {
    return null;
  }
}

/**
 * The schedule workspace -- the Manager's single-screen surface for the
 * optimize -> review -> adjust -> deploy loop (see
 * SCHEDULE_WORKFLOW_IMPROVEMENT_PLAN.md for the full journey design).
 *
 * Layout follows the Overview page's single-viewport system: at lg+ the
 * page pins to `100dvh` minus the portal chrome and never scrolls; below
 * lg it stacks and scrolls normally. Three bands: a top strip (title +
 * week/deploy status + optimizer scorecard + actions), the day tabs, and
 * the two-pane workspace -- routing map left, day agenda right, both
 * driven by the same `day` URL param. "All" swaps the agenda for the
 * WeekMatrix count grid; per-day is the default (today's workday when the
 * page is opened Mon-Fri, else Mon), which is the workspace's core
 * information-overload defense: one day's <=18 visits rendered in detail
 * instead of the old ~90-card five-column board.
 *
 * Replaced by this workspace (git history preserves them): the
 * always-visible "Adjust this week's schedule" table (schedule-editor),
 * the five-column ScheduleBoard, the map-only DayFilter, and the
 * below-map legend row (now an overlay inside the map pane).
 */
export default async function SchedulePage({ searchParams }: SchedulePageProps) {
  const { day: dayParam } = await searchParams;

  // Default to today's workday (a Manager opening this mid-week wants
  // today, not Monday); weekends fall back to Mon. "All" is an explicit
  // choice via the day strip.
  const todayIndex = new Date().getDay(); // 0 = Sun .. 6 = Sat
  const defaultDay = todayIndex >= 1 && todayIndex <= 5 ? DAY_ORDER[todayIndex - 1] : "Mon";
  const selectedDay =
    dayParam === "All"
      ? "All"
      : dayParam && (DAY_ORDER as readonly string[]).includes(dayParam)
        ? dayParam
        : defaultDay;

  const supabase = await createClient();

  // Phase 14 fix (kept from the pre-workspace page): inspector_schedules
  // accumulates every week ever deployed; only the current week is this
  // page's subject.
  const weekOf = currentWeekMonday();

  const [{ data: rows }, summary] = await Promise.all([
    supabase
      .from("inspector_schedules")
      .select(
        "id, inspector_id, scheduled_day, week_of, cluster, inspector:profiles!inspector_schedules_inspector_id_fkey(full_name), project:projects(project_key, name_of_project, municipality, risk_tier, latitude, longitude)"
      )
      .eq("week_of", weekOf)
      .order("scheduled_day"),
    fetchOptimizerSummary(),
  ]);

  const weekRows = rows ?? [];

  // Stable per-inspector colors: sort names first so the same inspector
  // keeps the same color across renders/day switches.
  const inspectorNames = Array.from(
    new Set(
      weekRows.map(
        (row) => (row.inspector as unknown as JoinedInspector)?.full_name ?? "Unassigned"
      )
    )
  ).sort();
  const colorByInspector = new Map(
    inspectorNames.map((name, i) => [name, INSPECTOR_COLORS[i % INSPECTOR_COLORS.length]])
  );

  // Day tabs: count + Critical/High presence for every day, plus "All".
  const tabs: DayTabInfo[] = [
    { day: "All", count: weekRows.length, critical: 0, high: 0 },
    ...DAY_ORDER.map((day) => ({ day, count: 0, critical: 0, high: 0 })),
  ];
  const tabByDay = new Map(tabs.map((tab) => [tab.day, tab]));
  for (const row of weekRows) {
    const tab = tabByDay.get(row.scheduled_day);
    if (!tab) continue;
    tab.count += 1;
    const tier = (row.project as unknown as JoinedProject | null)?.risk_tier;
    if (tier === "Critical") {
      tab.critical += 1;
      tabByDay.get("All")!.critical += 1;
    } else if (tier === "High") {
      tab.high += 1;
      tabByDay.get("All")!.high += 1;
    }
  }

  const mapPoints: ScheduleMapPoint[] = weekRows
    .filter((row) => selectedDay === "All" || row.scheduled_day === selectedDay)
    .map((row) => {
      const inspectorName =
        (row.inspector as unknown as JoinedInspector)?.full_name ?? "Unassigned";
      const project = row.project as unknown as JoinedProject | null;
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

  // Per-inspector week totals (capacity chips need them regardless of the
  // selected day).
  const weekCountByInspectorId = new Map<string, number>();
  for (const row of weekRows) {
    weekCountByInspectorId.set(
      row.inspector_id,
      (weekCountByInspectorId.get(row.inspector_id) ?? 0) + 1
    );
  }

  // Selected day's agenda, grouped by inspector (sorted by name).
  const agendaGroups: AgendaGroup[] = [];
  if (selectedDay !== "All") {
    const groupByInspectorId = new Map<string, AgendaGroup>();
    for (const row of weekRows) {
      if (row.scheduled_day !== selectedDay) continue;
      const inspectorName =
        (row.inspector as unknown as JoinedInspector)?.full_name ?? "Unassigned";
      const project = row.project as unknown as JoinedProject | null;
      let group = groupByInspectorId.get(row.inspector_id);
      if (!group) {
        group = {
          inspectorId: row.inspector_id,
          inspectorName,
          color: colorByInspector.get(inspectorName) ?? INSPECTOR_COLORS[0],
          items: [],
          weekCount: weekCountByInspectorId.get(row.inspector_id) ?? 0,
        };
        groupByInspectorId.set(row.inspector_id, group);
      }
      group.items.push({
        id: row.id,
        projectKey: project?.project_key ?? "unknown",
        projectName: project?.name_of_project ?? "Unknown project",
        municipality: project?.municipality ?? null,
        riskTier: project?.risk_tier ?? null,
        cluster: row.cluster,
      });
    }
    agendaGroups.push(
      ...Array.from(groupByInspectorId.values()).sort((a, b) =>
        a.inspectorName.localeCompare(b.inspectorName)
      )
    );
  }

  // "All" view: inspector x day count matrix.
  const matrixRows: WeekMatrixRow[] = inspectorNames.map((name) => ({
    inspectorName: name,
    color: colorByInspector.get(name) ?? INSPECTOR_COLORS[0],
    cells: Object.fromEntries(DAY_ORDER.map((day) => [day, { count: 0, critical: 0, high: 0 }])),
    weekTotal: 0,
  }));
  const matrixByName = new Map(matrixRows.map((row) => [row.inspectorName, row]));
  for (const row of weekRows) {
    const inspectorName =
      (row.inspector as unknown as JoinedInspector)?.full_name ?? "Unassigned";
    const matrixRow = matrixByName.get(inspectorName);
    const cell = matrixRow?.cells[row.scheduled_day];
    if (!matrixRow || !cell) continue;
    cell.count += 1;
    matrixRow.weekTotal += 1;
    const tier = (row.project as unknown as JoinedProject | null)?.risk_tier;
    if (tier === "Critical") cell.critical += 1;
    else if (tier === "High") cell.high += 1;
  }

  // Captions composed as plain strings (the repo's Next build fuses JSX
  // boundary whitespace around entities -- Overview convention).
  const weekLabel = new Date(`${weekOf}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
  const headerCaption =
    weekRows.length > 0
      ? `Week of ${weekLabel} · ${weekRows.length} visits deployed · PuLP-optimized`
      : `Week of ${weekLabel} · nothing deployed yet`;
  const paneTitle =
    selectedDay === "All" ? "Week at a glance" : `${DAY_FULL_NAMES[selectedDay]} agenda`;
  const paneCount =
    selectedDay === "All" ? weekRows.length : (tabByDay.get(selectedDay)?.count ?? 0);
  const paneCaption = `${paneCount} visit${paneCount === 1 ? "" : "s"}`;
  const emptyStateText =
    `No visits are scheduled for the week of ${weekLabel}. ` +
    `Run the optimizer, then publish its output with "Deploy latest schedule" above.`;

  return (
    <div className="flex flex-col gap-3 lg:h-[calc(100dvh-7.25rem)] lg:min-h-135 lg:overflow-hidden">
      {/* ---- Top strip: identity, status, scorecard, actions ---- */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div>
          <h1 className="text-xl font-semibold text-brand-navy">Schedule</h1>
          <p className="text-xs text-slate-500">{headerCaption}</p>
        </div>
        <Scorecard summary={summary} />
        <DeployScheduleButton />
      </div>

      <div className="shrink-0">
        <DayStrip tabs={tabs} current={selectedDay} />
      </div>

      {/* ---- Workspace: map pane + agenda pane ---- */}
      <div className="grid gap-3 lg:min-h-0 lg:flex-1 lg:grid-cols-[1.1fr_1fr]">
        <Card className="flex flex-col p-2 lg:min-h-0">
          <div className="relative min-h-80 flex-1 lg:min-h-0">
            <ScheduleMapLoader points={mapPoints} />
            {inspectorNames.length > 0 && (
              <div className="absolute bottom-2 left-2 z-1000 flex max-w-[70%] flex-wrap gap-x-3 gap-y-1 rounded-md bg-white/90 px-2 py-1.5 text-[11px] text-slate-600 shadow-sm">
                {inspectorNames.map((name) => (
                  <span key={name} className="flex items-center gap-1">
                    <span
                      className="inline-block size-2.5 rounded-full border border-white"
                      style={{ background: colorByInspector.get(name) }}
                    />
                    {name}
                  </span>
                ))}
              </div>
            )}
          </div>
        </Card>

        <Card className="flex flex-col p-4 lg:min-h-0">
          <div className="mb-2 flex shrink-0 items-baseline justify-between gap-2">
            <p className="text-sm font-semibold text-brand-navy">{paneTitle}</p>
            <p className="text-[11px] text-slate-400">{paneCaption}</p>
          </div>
          <div className="min-h-80 flex-1 overflow-y-auto pr-1 lg:min-h-0">
            {weekRows.length === 0 ? (
              <p className="p-4 text-center text-sm text-slate-400">{emptyStateText}</p>
            ) : selectedDay === "All" ? (
              <WeekMatrix days={DAY_ORDER} rows={matrixRows} />
            ) : (
              <AgendaPane groups={agendaGroups} />
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
