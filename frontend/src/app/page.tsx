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

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", userData!.user.id)
    .single();

  redirect(profile?.role === "manager" ? "/manager" : "/inspector");
}
