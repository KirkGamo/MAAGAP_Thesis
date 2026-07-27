import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

// Next.js 16 renamed `middleware.ts` to `proxy.ts` and the exported
// `middleware` function to `proxy`. This file's only job is refreshing the
// Supabase Auth cookie on every non-static request — see
// src/lib/supabase/proxy.ts for why role-based access control deliberately
// lives elsewhere (app/manager/layout.tsx, app/inspector/layout.tsx).
export async function proxy(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - image file extensions
     * Feel free to modify this pattern to include more paths.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
