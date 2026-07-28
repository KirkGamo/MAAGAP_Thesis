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
    .select("id, full_name, role, active")
    .eq("id", userId)
    .single();

  if (profileError || !profile) {
    // Log the real reason rather than only redirecting -- a
    // "not signed in" bounce is indistinguishable from an RLS error
    // (e.g. the profiles infinite-recursion bug fixed in
    // supabase/fix_rls_recursion.sql) without this, and that's exactly
    // what made the Phase 8.5 login loop hard to diagnose from the
    // request log alone.
    //
    // PostgrestError instances log as "{}" via console.error's default
    // object formatting once they cross the Server Component/dev-overlay
    // boundary (their real fields aren't own-enumerable by the time
    // they're serialized for the browser console) -- pulling out
    // message/code/details/hint explicitly avoids that opacity, which is
    // exactly the class of bug this log line exists to prevent in the
    // first place.
    console.error("[requireRole] Could not load profile for user %s:", userId, {
      message: profileError?.message,
      code: profileError?.code,
      details: profileError?.details,
      hint: profileError?.hint,
    });
    redirect("/login");
  }

  // Phase 12: a Manager-deactivated account (see the new Inspectors tab)
  // is signed out entirely rather than just blocked from one portal --
  // "deactivated" should mean "can't get in anywhere", not "can log in
  // but sees an empty screen". Sign-out happens here (not earlier, in
  // proxy.ts) for the same reason role checks live here and not in
  // proxy.ts: Next.js 16's guidance keeps authorization logic out of the
  // more restricted Proxy runtime (see proxy.ts's docstring).
  if (!profile.active) {
    await supabase.auth.signOut();
    redirect("/login?deactivated=1");
  }

  if (!allowed.includes(profile.role)) {
    redirect(profile.role === "manager" ? "/manager" : "/inspector");
  }

  return profile;
}
