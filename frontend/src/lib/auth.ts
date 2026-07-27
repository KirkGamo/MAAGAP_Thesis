import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { UserRole } from "@/types/database";

/**
 * Server-only helper used by root/portal layouts to enforce Manager vs.
 * Inspector access. Per Next.js 16's guidance, this kind of authorization
 * check belongs in layouts/Server Components rather than in proxy.ts —
 * see src/lib/supabase/proxy.ts for why.
 *
 * Uses `getUser()` (not `getSession()` or `getClaims()`). `getUser()`
 * revalidates the token against the Supabase Auth server on every call,
 * which works identically regardless of whether a project has asymmetric
 * JWT signing keys enabled. `getClaims()` verifies locally instead and
 * depends on that key configuration — on a project still using the
 * legacy shared JWT secret, `getClaims()` failed to verify a freshly
 * signed-in user at all, bouncing every request straight back to /login
 * (the exact bug reported in Phase 8.5). `getSession()` is avoided
 * because it does not guarantee revalidation of a potentially-stale
 * token.
 */
export async function requireRole(allowed: UserRole[]) {
  const supabase = await createClient();

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData?.user) {
    redirect("/login");
  }

  const userId = userData.user.id;
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, full_name, role")
    .eq("id", userId)
    .single();

  if (profileError || !profile) {
    redirect("/login");
  }

  if (!allowed.includes(profile.role)) {
    redirect(profile.role === "manager" ? "/manager" : "/inspector");
  }

  return profile;
}
