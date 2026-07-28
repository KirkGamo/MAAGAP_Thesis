"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/manager", label: "Overview" },
  { href: "/manager/ppas", label: "Program, Projects, and Activities (PPAs)" },
  { href: "/manager/schedule", label: "Schedule" },
  { href: "/manager/inspectors", label: "Inspectors" },
  { href: "/manager/models", label: "Models" },
  { href: "/manager/reports", label: "Reports" },
];

/**
 * Phase 12: the left sidebar, restored after the Phase 11 top-tab
 * experiment. Active-state highlighting needs the current pathname, so
 * (like Phase 11's tab-nav.tsx before it) this one sliver of an otherwise
 * server-rendered layout has to be a Client Component.
 */
export function SidebarNav() {
  const pathname = usePathname();

  return (
    <aside className="hidden w-64 shrink-0 border-r border-brand-navy/10 bg-white p-4 md:block">
      <div className="mb-6 px-2">
        <Image
          src="/maagap-logo.png"
          alt="MAAGAP"
          width={140}
          height={46}
          priority
          className="h-auto w-full max-w-[140px]"
        />
        <p className="mt-1 text-xs font-medium text-brand-blue">Manager Portal</p>
      </div>
      <nav className="flex flex-col gap-1">
        {NAV_ITEMS.map((item) => {
          const isActive =
            item.href === "/manager" ? pathname === "/manager" : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "rounded-md px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "bg-brand-surface text-brand-navy"
                  : "text-brand-navy/70 hover:bg-brand-surface hover:text-brand-navy"
              )}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
