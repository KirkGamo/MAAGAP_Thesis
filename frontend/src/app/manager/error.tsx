"use client";

import { ErrorPanel } from "@/components/error-panel";

/**
 * Covers every /manager route that does not declare its own boundary.
 *
 * The manager surface reads from two places: Supabase for project data, and the
 * FastAPI ML service for model metrics, the latest schedule and optimizer runs.
 * Only the second is likely to be down independently, so the copy leads with it
 * while staying honest that it could be either.
 */
export default function ManagerError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <ErrorPanel
      title="Something went wrong"
      whatFailed="This page could not load. The ML service and the database are deployed separately, so one can be unavailable while the other is fine."
      stillWorks="Signing in, and any page already open in another tab."
      error={error}
      reset={reset}
    />
  );
}
