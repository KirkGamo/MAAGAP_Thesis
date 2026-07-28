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
 *
 *   3. setInspectorSlug(): also the regular RLS-respecting client. Maps a
 *      real profile to one of optimization_engine.py's fixed synthetic
 *      roster slots ("Inspector_1".."Inspector_6") -- see
 *      profiles.inspector_slug's column comment in schema.sql. This is
 *      the missing link actions/deploy-schedule.ts needs to translate the
 *      PuLP solve's CSV output into real inspector_schedules rows.
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

export async function setInspectorSlug(
  profileId: string,
  slug: string
): Promise<InspectorActionResult> {
  const trimmed = slug.trim();

  const { error } = await (await createClient())
    .from("profiles")
    .update({ inspector_slug: trimmed ? trimmed : null })
    .eq("id", profileId);

  if (error) {
    // A unique-constraint violation (23505) means someone already claimed
    // this slug -- surface that plainly rather than a raw Postgres error
    // string, since this is the one mistake a Manager is likely to make
    // here (typo-ing the same slug for two different people).
    if (error.code === "23505") {
      return { success: false, error: `"${trimmed}" is already assigned to another inspector.` };
    }
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
