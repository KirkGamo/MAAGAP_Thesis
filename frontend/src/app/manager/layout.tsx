import Image from "next/image";
import Link from "next/link";
import { requireRole } from "@/lib/auth";

/**
 * Manager portal shell. `requireRole` redirects to /inspector if a
 * signed-in Inspector tries to reach a /manager/* route, and to /login if
 * no session exists at all — this is the RBAC enforcement point for the
 * whole portal (see src/lib/auth.ts).
 *
 * Phase 9: sidebar now shows the actual MAAGAP logo (public/maagap-logo.png)
 * instead of a plain-text wordmark, and uses the brand palette defined in
 * globals.css's @theme block (sampled from the logo itself).
 */
export default async function ManagerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await requireRole(["manager"]);

  const navItems = [
    { href: "/manager", label: "Overview" },
    { href: "/manager/import", label: "Import Projects" },
    { href: "/manager/backlog", label: "Backlog" },
    { href: "/manager/schedule", label: "Schedule" },
    { href: "/manager/map", label: "Risk Map" },
  ];

  return (
    <div className="flex min-h-screen bg-brand-surface">
      <aside className="hidden w-60 shrink-0 border-r border-brand-navy/10 bg-white p-4 md:block">
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
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-md px-3 py-2 text-sm font-medium text-brand-navy/80 transition-colors hover:bg-brand-surface hover:text-brand-navy"
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="mt-8 border-t border-brand-navy/10 px-2 pt-4 text-xs text-slate-500">
          Signed in as
          <div className="font-medium text-brand-navy">
            {profile.full_name ?? "Manager"}
          </div>
        </div>
      </aside>
      <main className="flex-1 p-6 md:p-8">{children}</main>
    </div>
  );
}
