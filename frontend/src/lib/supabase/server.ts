import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "@/types/database";

/**
 * Supabase client for use in Server Components, Server Actions, and Route
 * Handlers. Next.js 16 requires `cookies()` to be awaited — synchronous
 * access to dynamic request APIs was removed in this version.
 *
 * Server Components cannot write cookies (only read them), so a call to
 * `setAll` from a Server Component will throw if middleware/proxy isn't
 * also refreshing the session — this is expected and harmless as long as
 * `proxy.ts` (see below) is wired up to call `updateSession` on every
 * request, which is where the actual cookie write happens.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Called from a Server Component — the proxy is responsible
            // for refreshing the session in this case. Safe to ignore.
          }
        },
      },
    }
  );
}

/**
 * Service-role client for trusted, server-only operations that must bypass
 * Row Level Security (e.g. a Manager's bulk CSV project import). NEVER
 * import this into a Client Component or anything that could ship the
 * service role key to the browser — it has no RLS restrictions at all.
 */
export function createServiceRoleClient() {
  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      cookies: {
        getAll() {
          return [];
        },
        setAll() {
          // no-op: the service-role client is never used to manage a
          // browser session.
        },
      },
    }
  );
}
