import { redirect } from "next/navigation";

/**
 * Phase 12: "Backlog" was renamed to "Program, Projects, and Activities
 * (PPAs)" and moved to /manager/ppas (which also gained a table/map view
 * toggle and the Import Projects action). This route is kept as a
 * redirect rather than deleted outright so any existing bookmark/external
 * link to /manager/backlog still lands somewhere useful instead of
 * 404ing — the same pattern used for /manager/map -> /manager/monitoring
 * in Phase 11 (itself now further redirected, see that route).
 */
export default function BacklogRedirectPage() {
  redirect("/manager/ppas");
}
