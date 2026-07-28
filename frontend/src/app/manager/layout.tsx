import { Suspense } from "react";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { NotificationBell } from "@/components/tremor/notification-bell";
import { UserMenu } from "@/components/tremor/user-menu";
import { SidebarNav } from "./sidebar-nav";
import { KpiHeader } from "./kpi-header";
import { KpiHeaderSkeleton } from "./kpi-header-skeleton";

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

        {/* Phase 13: the KPI row's own data-fetching lives in KpiHeader
            (see kpi-header.tsx) and is wrapped in its own Suspense boundary
            here -- previously these three queries were awaited directly in
            this layout, which blocked the ENTIRE shell (sidebar, header)
            behind them on every single /manager/* navigation. Now the
            shell paints immediately and only this row shows
            KpiHeaderSkeleton briefly while its data loads. */}
        <div className="px-6 pt-6">
          <Suspense fallback={<KpiHeaderSkeleton />}>
            <KpiHeader />
          </Suspense>
        </div>

        <main className="flex-1 px-6 py-6">{children}</main>
      </div>
    </div>
  );
}

