import { requireRole } from "@/lib/auth";
import { SignOutButton } from "./sign-out-button";

/**
 * Inspector portal shell — deliberately mobile-first (single-column,
 * bottom-anchored primary actions, large tap targets) since field
 * inspectors use this on a phone in the field, not a desktop browser.
 * `requireRole` bounces a signed-in Manager back to /manager and an
 * unauthenticated visitor to /login.
 */
export default async function InspectorLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await requireRole(["inspector"]);

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col bg-brand-surface">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-brand-navy/10 bg-white px-4 py-3">
        <div>
          <p className="text-sm font-semibold text-brand-navy">MAAGAP</p>
          <p className="text-xs text-slate-500">{profile.full_name ?? "Inspector"}</p>
        </div>
        <SignOutButton />
      </header>
      <main className="flex-1 px-4 py-4">{children}</main>
    </div>
  );
}
