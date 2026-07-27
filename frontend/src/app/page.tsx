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
  const { data: claimsData } = await supabase.auth.getClaims();

  if (!claimsData?.claims) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", claimsData!.claims.sub)
    .single();

  redirect(profile?.role === "manager" ? "/manager" : "/inspector");
}
