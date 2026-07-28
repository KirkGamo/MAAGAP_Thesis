import Image from "next/image";
import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { TabNav } from "@/components/tremor/tab-nav";
import { NotificationBell } from "@/components/tremor/notification-bell";
import { UserMenu } from "@/components/tremor/user-menu";
import { Metric, MetricLabel } from "@/components/tremor/metric";

/**
 * Manager portal shell. `requireRole` redirects to /inspector if a
 * signed-in Inspector tries to reach a /manager/* route, and to /login if
 * no session exists at all — this is the RBAC enforcement point for the
 * whole portal (see src/lib/auth.ts). Unchanged since Phase 8.5.
 *
 * PHASE 11 REWRITE: replaces the Phase 9 left sidebar with the layout shown
 * in the attached premium Tremor template screenshots -- a slim top bar
 * (logo, notification bell, user menu), a shared inline KPI row, and an
 * underlined tab bar. Per the architecture decision made explicitly with
 * the user before this rewrite: the four tabs below (Overview, Monitoring,
 * Backlog, Schedule) are real routes re-skinned to look like tabs (see
 * components/tremor/tab-nav.tsx's docstring for the full reasoning), not a
 * single client-side page — every page under /manager/* keeps its own
 * server-side Supabase fetch and stays covered by the requireRole() gate
 * above, unchanged. "Import Projects" (previously its own nav item) moves
 * to a header action button rather than a fifth tab, since the template's
 * tab count is 4 and Import is an action ("do something"), not a place
 * ("look at something") — the same distinction the Support Dashboard
 * template draws between its tabs and its "Create Ticket" header button.
 * "Risk Map" (previously its own nav item) is folded into the new
 * Monitoring tab alongside the municipality bar chart (see
 * app/manager/monitoring/page.tsx) rather than kept as a standalone
 * destination.
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

  const tabItems = [
    { href: "/manager", label: "Overview" },
    { href: "/manager/monitoring", label: "Monitoring" },
    { href: "/manager/backlog", label: "Backlog" },
    { href: "/manager/schedule", label: "Schedule" },
  ];

  // Phase 11, Task 2: the sticky inline KPI row shown above the tabs in
  // the attached "Quotes" template (Lead-to-Quote Ratio / Project Load /
  // Win Probability). One round trip per metric, computed here (not per-
  // tab) since it's meant to stay visible/consistent across every tab.
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
    // figure anywhere in this schema to divide by (unlike the Agents
    // template's "Capacity (mins)" column, which this app has no
    // equivalent of) -- this is a real, honestly-labeled coverage ratio
    // instead: assigned vs. total ongoing.
    supabase.from("inspector_schedules").select("project_id"),
  ]);

  const totalActive = activeProjects.count ?? 0;
  const criticalCount = criticalProjects.count ?? 0;
  const distinctScheduledProjects = new Set((scheduledThisWeek.data ?? []).map((r) => r.project_id)).size;
  const capacityPct = totalActive > 0 ? Math.round((distinctScheduledProjects / totalActive) * 100) : 0;

  return (
    <div className="min-h-screen bg-brand-surface">
      <header className="sticky top-0 z-40 border-b border-brand-navy/10 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
          <Link href="/manager" className="flex items-center gap-2">
            <Image src="/maagap-logo.png" alt="MAAGAP" width={120} height={40} priority className="h-8 w-auto" />
          </Link>
          <div className="flex items-center gap-3">
            <NotificationBell />
            <UserMenu fullName={profile.full_name} email={user?.email ?? null} />
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-6 pt-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-brand-navy">Manager Portal</h1>
            <p className="text-sm text-slate-500">
              Real-time monitoring of PPDO project risk with AI-powered insights.
            </p>
          </div>
          <Button asChild>
            <Link href="/manager/import">Import Projects</Link>
          </Button>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-6 sm:grid-cols-3">
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

        <div className="mt-6">
          <TabNav items={tabItems} />
        </div>
      </div>

      <main className="mx-auto max-w-7xl px-6 py-6">{children}</main>
    </div>
  );
}
