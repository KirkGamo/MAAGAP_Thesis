import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { currentWeekMonday } from "@/lib/current-week";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, riskTierVariant } from "@/components/ui/badge";
import { ChevronRight, MapPin } from "lucide-react";

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

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

  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
          Today &middot; {today}
        </p>
        <h1 className="text-xl font-semibold text-slate-900">Your route</h1>
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

      <Card>
        <CardHeader className="py-3">
          <CardTitle className="text-sm text-slate-500">
            Need to file a report for a project not on today&apos;s list?
          </CardTitle>
        </CardHeader>
      </Card>
    </div>
  );
}
