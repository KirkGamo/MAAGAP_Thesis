import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/**
 * Root route: never rendered directly. Its only job is checking the
 * signed-in user's role and forwarding to the right portal, so /login
 * doesn't need to know about roles and neither portal needs a "which
 * portal am I" landing page of its own.
 */
export default async function RootPage() {
  const supabase = await createClient();
  // See lib/auth.ts's requireRole() docstring for why this uses getUser()
  // rather than getClaims() — the latter depends on JWT signing-key
  // configuration this project may not have, and silently treated every
  // signed-in user as unauthenticated when it didn't.
  const { data: userData } = await supabase.auth.getUser();

  if (!userData?.user) {
    redirect("/login");
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", userData!.user.id)
    .single();

  // Don't silently fall through to "/inspector" on a failed/empty lookup —
  // that previously masked a real bug (an RLS infinite-recursion error on
  // public.profiles, fixed in supabase/schema.sql + fix_rls_recursion.sql)
  // by making it look like "signed in, but somehow always an Inspector."
  // If the profile genuinely can't be read, send the user back to sign in
  // rather than guessing a role, and log why on the server so it's
  // debuggable instead of a silent redirect loop.
  if (profileError || !profile) {
    console.error(
      "[RootPage] Could not load profile for signed-in user %s:",
      userData!.user.id,
      profileError
    );
    redirect("/login");
  }

  redirect(profile.role === "manager" ? "/manager" : "/inspector");
}
