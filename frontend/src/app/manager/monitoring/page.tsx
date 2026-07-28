import { redirect } from "next/navigation";

/**
 * Phase 12: the standalone Monitoring tab (Phase 11) was removed — its
 * municipality BarChart moved back to the Overview page (see
 * ../page.tsx), and its Risk Map moved into the new PPAs tab's map view
 * toggle (see ../ppas/page.tsx). Kept as a redirect for the same reason
 * every other renamed/removed route in this portal is: an existing
 * bookmark/link should still land somewhere useful.
 */
export default function MonitoringRedirectPage() {
  redirect("/manager/ppas?view=map");
}
