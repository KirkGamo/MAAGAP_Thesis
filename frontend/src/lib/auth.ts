import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { UserRole } from "@/types/database";

/**
 * Server-only helper used by root/portal layouts to enforce Manager vs.
 * Inspector access. Per Next.js 16's guidance, this kind of authorization
 * check belongs in layouts/Server Components rather than in proxy.ts —
 * see src/lib/supabase/proxy.ts for why.
 *
 * Uses `getClaims()` (not `getSession()`), which validates the JWT
 * signature against Supabase's published keys on every call and is the
 * method Supabase's own docs recommend for protecting pages/data.
 */
export async function requireRole(allowed: UserRole[]) {
  const supabase = await createClient();

  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  if (claimsError || !claimsData?.claims) {
    redirect("/login");
  }

  const userId = claimsData.claims.sub;
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
