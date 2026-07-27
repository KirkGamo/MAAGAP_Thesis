import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Refreshes the Supabase Auth session cookie on every matched request.
 *
 * Next.js Server Components can only READ cookies, not write them, so the
 * Proxy (Next.js 16's renamed `middleware.ts` — see /proxy.ts at the repo
 * root) is what actually persists a refreshed Auth token: it calls
 * `supabase.auth.getClaims()`, which both validates the current token and
 * triggers a refresh if it's expired, then writes the refreshed cookie to
 * both the incoming request (so Server Components in this same request
 * see the fresh token) and the outgoing response (so the browser gets it).
 *
 * IMPORTANT: per Supabase's guidance, role/permission checks (Manager vs.
 * Inspector) are NOT done here. The Proxy's only job is keeping the
 * session cookie fresh; actual route protection lives in
 * `app/manager/layout.tsx` and `app/inspector/layout.tsx`, which query the
 * `profiles` table for the signed-in user's role and redirect if it
 * doesn't match the portal being requested. Keeping authorization logic
 * out of the Proxy (rather than centralizing it there) is the pattern
 * Next.js 16 recommends now that Proxy runs in a more restricted runtime.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // getClaims() validates the JWT signature locally (or via getUser() as a
  // fallback for symmetric-key projects) and refreshes it if expired.
  // Never rely on getSession() here — it does not guarantee revalidation.
  await supabase.auth.getClaims();

  return response;
}
