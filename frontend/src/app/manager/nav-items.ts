import {
  Brain,
  CalendarDays,
  ClipboardList,
  FolderKanban,
  HardHat,
  LayoutDashboard,
  type LucideIcon,
} from "lucide-react";

/**
 * The manager portal's pages, their labels and their icons, in one place.
 *
 * The sidebar and the page headers both read from this, so a page cannot end up
 * wearing one icon in the nav and another above its title. That was a real risk
 * rather than a hypothetical: before this, the sidebar was a plain text list
 * and every page header was hand-written, so there was no shared vocabulary to
 * drift from in the first place.
 *
 * Icon choices avoid collisions with meanings already established elsewhere in
 * the app, because an icon that means two things is worse than no icon:
 *
 *   LayoutDashboard  the manager role on the login page -> Overview
 *   FolderKanban     "Total Active Projects" in the KPI header -> PPAs
 *   HardHat          field work, and distinct from ClipboardCheck, which the
 *                    login page already uses for the inspector role
 *   ClipboardList    filed reports, kept separate from ClipboardCheck
 *   Gauge            NOT used here -- it already means capacity in the KPI
 *                    header, so Models takes Brain instead
 */
export interface NavItem {
  href: string;
  /** Full label, for the sidebar. */
  label: string;
  /** Short label for the page header, where the h1 carries the page name. */
  title: string;
  icon: LucideIcon;
}

export const NAV_ITEMS: NavItem[] = [
  { href: "/manager", label: "Overview", title: "Overview", icon: LayoutDashboard },
  {
    href: "/manager/ppas",
    label: "Program, Projects, and Activities (PPAs)",
    title: "Program, Projects, and Activities (PPAs)",
    icon: FolderKanban,
  },
  { href: "/manager/schedule", label: "Schedule", title: "Schedule", icon: CalendarDays },
  { href: "/manager/inspectors", label: "Inspectors", title: "Inspectors", icon: HardHat },
  { href: "/manager/models", label: "Models", title: "Models", icon: Brain },
  { href: "/manager/reports", label: "Reports", title: "Reports", icon: ClipboardList },
];

/** The icon for a page, by href. Returns undefined for routes not in the nav
 * (Import, Map), which deliberately have no sidebar entry. */
export function navIconFor(href: string): LucideIcon | undefined {
  return NAV_ITEMS.find((item) => item.href === href)?.icon;
}
