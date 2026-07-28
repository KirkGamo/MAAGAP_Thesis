import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { NotificationBell } from "@/components/tremor/notification-bell";
import { UserMenu } from "@/components/tremor/user-menu";
import { Metric, MetricLabel } from "@/components/tremor/metric";
import { SidebarNav } from "./sidebar-nav";

/**
 * Manager portal shell. `requireRole` redirects to /inspector if a
 * signed-in Inspector tries to reach a /manager/* route, and to /login if
 * no session exists at all — this is the RBAC enforcement point for the
 * whole portal (see src/lib/auth.ts). Unchanged since Phase 8.5, except it
 * now also enforces `profile.active` (see lib/auth.ts's Phase 12 comment).
 *
 * PHASE 12: brings back the left sidebar (the user's explicit call after
 * trying Phase 11's top-tab layout) with an updated nav: Overview,
 * "Program, Projects, and Activities (PPAs)" (was Backlog, now also hosts
 * the Risk Map as a view toggle), Schedule, Inspectors (new), Models
 * (new), and Reports (new). The Phase 11 top bar (logo + NotificationBell
 * + UserMenu) and the sticky inline KPI row are both kept — they don't
 * conflict with a sidebar, they just move to sit above the main content
 * area instead of above a tab bar. "Import Projects" moves off this
 * header entirely and into the PPAs tab itself (per the user's spec),
 * since it's PPA-specific data entry, not a portal-wide action.
 */
export default async function ManagerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await requireRole(["manager"]);
  const supabase = await createClient();

  // Second getUser() call purely for the email address to show in
  // UserMenu -- requireRole() already made this exact call internally
  // (see lib/auth.ts) but doesn't return the email, and it isn't worth
  // widening that shared helper's return shape (used by both portals) for
  // one cosmetic field here.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Phase 11, Task 2 (kept as-is in Phase 12): the sticky inline KPI row.
  // One round trip per metric, computed here (not per-page) since it's
  // meant to stay visible/consistent regardless of which nav item is
  // active.
  const [activeProjects, criticalProjects, scheduledThisWeek] = await Promise.all([
    supabase.from("projects").select("id", { count: "exact", head: true }).eq("status", "on_going"),
    supabase
      .from("projects")
      .select("id", { count: "exact", head: true })
      .eq("status", "on_going")
      .eq("risk_tier", "Critical"),
    // "Optimized Inspector Capacity": what fraction of currently-ongoing
    // projects already have an inspector deployment assigned via the most
    // recent PuLP solve (see ml-service/optimization_engine.py,
    // inspector_schedules). Deliberately not a fabricated capacity/
    // utilization percentage -- there's no per-inspector max-capacity
    // figure anywhere in this schema to divide by -- this is a real,
    // honestly-labeled coverage ratio instead: assigned vs. total ongoing.
    supabase.from("inspector_schedules").select("project_id"),
  ]);

  const totalActive = activeProjects.count ?? 0;
  const criticalCount = criticalProjects.count ?? 0;
  const distinctScheduledProjects = new Set((scheduledThisWeek.data ?? []).map((r) => r.project_id)).size;
  const capacityPct = totalActive > 0 ? Math.round((distinctScheduledProjects / totalActive) * 100) : 0;

  return (
    <div className="flex min-h-screen bg-brand-surface">
      <SidebarNav />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-40 border-b border-brand-navy/10 bg-white">
          <div className="flex items-center justify-end gap-3 px-6 py-3">
            <NotificationBell />
            <UserMenu fullName={profile.full_name} email={user?.email ?? null} />
          </div>
        </header>

        <div className="px-6 pt-6">
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
            <div>
              <MetricLabel>Total Active Projects</MetricLabel>
              <Metric>{totalActive.toLocaleString()}</Metric>
            </div>
            <div>
              <MetricLabel>Critical Risk Load</MetricLabel>
              <Metric className={criticalCount > 0 ? "text-red-600" : undefined}>
                {criticalCount.toLocaleString()}
              </Metric>
            </div>
            <div>
              <MetricLabel>Optimized Inspector Capacity</MetricLabel>
              <Metric>{capacityPct}%</Metric>
              <p className="mt-0.5 text-xs text-slate-400">
                {distinctScheduledProjects} of {totalActive} ongoing projects have a deployed inspector
              </p>
            </div>
          </div>
        </div>

        <main className="flex-1 px-6 py-6">{children}</main>
      </div>
    </div>
  );
}

