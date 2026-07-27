import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Refreshes the Supabase Auth session cookie on every matched request.
 *
 * Next.js Server Components can only READ cookies, not write them, so the
 * Proxy (Next.js 16's renamed `middleware.ts` — see /proxy.ts at the repo
 * root) is what actually persists a refreshed Auth token: it calls
 * `supabase.auth.getUser()`, which both validates the current token
 * (against the Supabase Auth server) and triggers a refresh if it's
 * expired, then writes the refreshed cookie to both the incoming request
 * (so Server Components in this same request see the fresh token) and the
 * outgoing response (so the browser gets it).
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

  // getUser() revalidates the token against the Supabase Auth server (and
  // transparently refreshes it via the refresh token, if expired) — this
  // is what actually writes a refreshed cookie through the adapter above.
  //
  // An earlier version of this file called getClaims() instead, on the
  // assumption that supabase-js falls back to a network check when a
  // project doesn't have asymmetric JWT signing keys enabled. In practice
  // that assumption caused a real login bug (Phase 8.5): on a project
  // still using the legacy HS256 shared JWT secret, getClaims() failed to
  // verify the token locally with no working fallback, so every
  // server-side check treated a freshly-signed-in user as unauthenticated
  // and bounced them straight back to /login. getUser() has no such
  // dependency — it works identically on every Supabase project
  // regardless of JWT signing-key configuration — so it's used everywhere
  // in this codebase now (see lib/auth.ts and app/page.tsx). Never rely on
  // getSession() here — it does not guarantee revalidation.
  await supabase.auth.getUser();

  return response;
}
