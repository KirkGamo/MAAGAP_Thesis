import Link from "next/link";
import { requireRole } from "@/lib/auth";

/**
 * Manager portal shell. `requireRole` redirects to /inspector if a
 * signed-in Inspector tries to reach a /manager/* route, and to /login if
 * no session exists at all — this is the RBAC enforcement point for the
 * whole portal (see src/lib/auth.ts).
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
  ];

  return (
    <div className="flex min-h-screen bg-slate-50">
      <aside className="hidden w-60 shrink-0 border-r border-slate-200 bg-white p-4 md:block">
        <div className="mb-6 px-2">
          <p className="text-sm font-semibold text-slate-900">MAAGAP</p>
          <p className="text-xs text-slate-500">Manager Portal</p>
        </div>
        <nav className="flex flex-col gap-1">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-md px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="mt-8 border-t border-slate-200 px-2 pt-4 text-xs text-slate-500">
          Signed in as
          <div className="font-medium text-slate-700">
            {profile.full_name ?? "Manager"}
          </div>
        </div>
      </aside>
      <main className="flex-1 p-6 md:p-8">{children}</main>
    </div>
  );
}
