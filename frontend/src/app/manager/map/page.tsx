import { redirect } from "next/navigation";

/**
 * Phase 11 folded /manager/map's content into a "Monitoring" tab; Phase 12
 * removed that tab in favor of a table/map toggle directly inside the new
 * PPAs tab (see ../ppas/page.tsx and ../ppas/view-toggle.tsx). This route
 * is kept as a redirect (now pointing straight at /manager/ppas?view=map
 * rather than chaining through the now-also-redirecting /manager/monitoring)
 * so any existing bookmark/external link still lands somewhere useful.
 */
export default function ProjectRiskMapRedirectPage() {
  redirect("/manager/ppas?view=map");
}
