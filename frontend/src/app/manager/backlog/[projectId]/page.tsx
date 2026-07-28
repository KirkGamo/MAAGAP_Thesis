import { redirect } from "next/navigation";

interface BacklogProjectRedirectProps {
  params: Promise<{ projectId: string }>;
}

/** Phase 12: see ../page.tsx's comment — /manager/backlog/[projectId]
 * redirects to its new home at /manager/ppas/[projectId]. */
export default async function BacklogProjectRedirectPage({ params }: BacklogProjectRedirectProps) {
  const { projectId } = await params;
  redirect(`/manager/ppas/${projectId}`);
}
