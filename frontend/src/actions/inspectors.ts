"use server";

/**
 * MAAGAP — Inspector account management (Phase 12, Inspectors tab).
 *
 * Two distinct write paths, using two different Supabase clients on
 * purpose:
 *
 *   1. toggleInspectorActive(): uses the regular RLS-respecting client
 *      (lib/supabase/server.ts's createClient()). The "profiles: managers
 *      update all" policy (see supabase/schema.sql / add_profiles_active.sql)
 *      is what actually authorizes this write — matching this codebase's
 *      established pattern (see actions/projects.ts's comment) of letting
 *      RLS be the enforcement layer rather than duplicating an is-manager
 *      check in application code.
 *
 *   2. inviteInspector(): MUST use the service-role client
 *      (createServiceRoleClient()). Supabase's Admin API
 *      (`auth.admin.inviteUserByEmail`) has no RLS-equivalent concept — it
 *      operates on auth.users directly and requires the service role key
 *      regardless of any Postgres policy. The new auth.users row triggers
 *      handle_new_user() (schema.sql), which creates the matching
 *      `profiles` row (role defaults to 'inspector', active defaults
 *      true) — full_name is threaded through via the invite's `data`
 *      option, which handle_new_user() reads via
 *      `raw_user_meta_data ->> 'full_name'`.
 */

import { revalidatePath } from "next/cache";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

export type InspectorActionResult =
  | { success: true }
  | { success: false; error: string };

export async function toggleInspectorActive(
  profileId: string,
  active: boolean
): Promise<InspectorActionResult> {
  const supabase = await createClient();

  const { error } = await supabase.from("profiles").update({ active }).eq("id", profileId);

  if (error) {
    return { success: false, error: error.message };
  }

  revalidatePath("/manager/inspectors");
  return { success: true };
}

export async function inviteInspector(
  email: string,
  fullName: string
): Promise<InspectorActionResult> {
  if (!email.trim()) {
    return { success: false, error: "Email is required." };
  }

  const supabase = createServiceRoleClient();

  const { error } = await supabase.auth.admin.inviteUserByEmail(email.trim(), {
    data: fullName.trim() ? { full_name: fullName.trim() } : undefined,
  });

  if (error) {
    return { success: false, error: error.message };
  }

  revalidatePath("/manager/inspectors");
  return { success: true };
}
