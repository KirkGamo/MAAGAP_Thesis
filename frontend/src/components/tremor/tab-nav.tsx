"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export interface TabNavItem {
  href: string;
  label: string;
}

/**
 * Phase 11: a Tremor-template-style underlined tab bar (see the attached
 * "Support / Retention / Workflow / Agents" screenshots) backed by REAL
 * Next.js routes rather than client-side content-swapping.
 *
 * Deliberate architectural choice (confirmed with the user before this
 * phase): each tab below is still its own URL, server-rendered, and still
 * goes through ManagerLayout's `requireRole(["manager"])` gate exactly as
 * before -- this component only changes how navigation between those
 * routes *looks* (an underlined tab bar instead of a sidebar list), not
 * how the app is structured. That preserves deep links, the browser back
 * button, and each page's independent server-side Supabase fetch, at the
 * cost of an exact one-to-one visual match with a single-page client tab
 * switcher (which would have required collapsing five independently
 * data-fetching Server Components into one).
 *
 * "Active" is determined via usePathname() rather than server-side
 * props, so this must be a Client Component -- it's the one interactive
 * sliver of an otherwise server-rendered layout.
 */
export function TabNav({ items }: { items: TabNavItem[] }) {
  const pathname = usePathname();

  return (
    <nav className="flex gap-6 border-b border-brand-navy/10">
      {items.map((item) => {
        // Exact match for "/manager" (Overview) so it doesn't stay
        // highlighted on every other /manager/* route; startsWith for
        // everything else so a sub-route (e.g. /manager/backlog/[id])
        // still highlights its parent tab.
        const isActive =
          item.href === "/manager"
            ? pathname === "/manager"
            : pathname === item.href || pathname.startsWith(`${item.href}/`);

        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "-mb-px border-b-2 px-1 py-3 text-sm font-medium transition-colors",
              isActive
                ? "border-brand-blue text-brand-blue"
                : "border-transparent text-slate-500 hover:border-brand-navy/20 hover:text-brand-navy"
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
