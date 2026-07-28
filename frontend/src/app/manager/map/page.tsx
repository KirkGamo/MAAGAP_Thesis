import { redirect } from "next/navigation";

/**
 * Phase 11, Task 4: /manager/map's content (the Risk Map) moved into the
 * new Monitoring tab (see ../monitoring/page.tsx), alongside the
 * municipality BarChart that used to live on the Overview page. This route
 * is kept as a redirect rather than deleted outright so any existing
 * bookmark/external link to /manager/map still lands somewhere useful,
 * instead of 404ing.
 */
export default function ProjectRiskMapPage() {
  redirect("/manager/monitoring");
}
