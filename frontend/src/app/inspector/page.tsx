import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { currentWeekMonday } from "@/lib/current-week";
import { Card, CardContent } from "@/components/ui/card";
import { Badge, riskTierVariant, statusVariant } from "@/components/ui/badge";
import { ChevronRight, MapPin } from "lucide-react";
import { STATUSES } from "@/app/manager/ppas/filters";

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const RECENT_REPORT_LIMIT = 5;

const STATUS_LABELS: Record<string, string> = Object.fromEntries(
  STATUSES.map((s) => [s.value, s.label])
);

/**
 * The Inspector's home screen: today's assigned site visits, read
 * directly from `inspector_schedules` (RLS restricts this to rows where
 * `inspector_id = auth.uid()` — see supabase/schema.sql), largest/most
 * tappable element first since this is the screen an inspector checks
 * first thing each field day.
 */
export default async function InspectorTodayPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const today = DAY_LABELS[new Date().getDay()];

  // Phase 14 fix: filtering by scheduled_day alone (e.g. "Mon") matches
  // EVERY Monday ever deployed across every week, not just this week's --
  // inspector_schedules keeps old weeks' rows around (only the current
  // week is replaced on redeploy). Without also scoping to the current
  // week, an inspector would see every historical Monday's assignments
  // merged into "today", not just the current one.
  const { data: assignments } = await supabase
    .from("inspector_schedules")
    .select(
      "id, scheduled_day, cluster, project:projects(id, project_key, name_of_project, location, municipality, risk_tier)"
    )
    .eq("inspector_id", user?.id ?? "")
    .eq("scheduled_day", today)
    .eq("week_of", currentWeekMonday());

  // The Inspector's own submission history. Until now there was no way
  // to confirm a report had actually been filed -- the form redirected
  // here and left no trace, which on a weak field connection is exactly
  // when you most need to know. Readable under "reports: inspectors read
  // own", so no extra scoping is required.
  const { data: recentRaw } = await supabase
    .from("monitoring_reports")
    .select("id, visited_at, status_observed, project:projects(name_of_project)")
    .eq("inspector_id", user?.id ?? "")
    .order("visited_at", { ascending: false })
    .limit(RECENT_REPORT_LIMIT);

  const recentReports = (recentRaw ?? []).map((r) => {
    const project = r.project as unknown as { name_of_project: string } | null;
    return {
      id: r.id,
      visitedAt: r.visited_at,
      projectName: project?.name_of_project ?? "Unknown project",
      statusObserved: r.status_observed,
      statusLabel: STATUS_LABELS[r.status_observed] ?? r.status_observed,
    };
  });

  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
          Today &middot; {today}
        </p>
        <h1 className="text-xl font-semibold text-brand-navy">Your route</h1>
      </div>

      {(!assignments || assignments.length === 0) && (
        <Card>
          <CardContent className="py-8 text-center text-sm text-slate-500">
            No site visits scheduled for today.
          </CardContent>
        </Card>
      )}

      <div className="flex flex-col gap-3">
        {(assignments ?? []).map((a) => {
          const project = a.project as unknown as {
            id: string;
            project_key: string;
            name_of_project: string;
            location: string;
            municipality: string | null;
            risk_tier: string | null;
          } | null;
          if (!project) return null;

          return (
            <Link key={a.id} href={`/inspector/report/${project.id}`}>
              <Card className="transition-shadow active:shadow-none">
                <CardContent className="flex items-center justify-between gap-3 py-4">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-slate-900">
                      {project.name_of_project}
                    </p>
                    <p className="mt-0.5 flex items-center gap-1 text-xs text-slate-500">
                      <MapPin className="size-3.5 shrink-0" />
                      <span className="truncate">{project.location}</span>
                    </p>
                    <div className="mt-2 flex items-center gap-2">
                      {project.risk_tier && (
                        <Badge variant={riskTierVariant(project.risk_tier)}>
                          {project.risk_tier}
                        </Badge>
                      )}
                      <span className="text-xs text-slate-400">{a.cluster}</span>
                    </div>
                  </div>
                  <ChevronRight className="size-5 shrink-0 text-slate-300" />
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>

      {/* This used to be a card asking the question with no way to answer
          it. A visit slips a day, or a site is passed on the way to
          another -- the report still has to be filable. */}
      <Link href="/inspector/projects">
        <Card className="transition-shadow active:shadow-none">
          <CardContent className="flex items-center justify-between gap-3 py-4">
            <div>
              <p className="font-medium text-slate-900">File for another project</p>
              <p className="mt-0.5 text-xs text-slate-500">
                Any project assigned to you, not just today&apos;s route.
              </p>
            </div>
            <ChevronRight className="size-5 shrink-0 text-slate-300" />
          </CardContent>
        </Card>
      </Link>

      {recentReports.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">
            Your recent reports
          </p>
          <Card>
            <CardContent className="flex flex-col divide-y divide-slate-100 p-0">
              {recentReports.map((report) => (
                <div key={report.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-800">
                      {report.projectName}
                    </p>
                    <p className="text-xs text-slate-400">
                      {new Date(report.visitedAt).toLocaleString()}
                    </p>
                  </div>
                  <Badge
                    variant={statusVariant(report.statusObserved)}
                    className="shrink-0 text-[10px]"
                  >
                    {report.statusLabel}
                  </Badge>
                </div>
              ))}
            </CardContent>
          </Card>
          <p className="mt-1.5 text-[11px] text-slate-400">
            Filed reports appear here — if a submission is missing, it never reached the office.
          </p>
        </div>
      )}
    </div>
  );
}
