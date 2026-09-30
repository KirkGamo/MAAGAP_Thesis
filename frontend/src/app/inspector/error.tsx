"use client";

import { ErrorPanel } from "@/components/error-panel";

/**
 * The inspector surface is used in the field, where connectivity is the most
 * likely cause of any failure. The copy says so plainly and, importantly, tells
 * an inspector their submitted work is not lost — report submission is
 * offline-tolerant, and telling someone in the field to simply "try again"
 * without saying that invites them to re-enter a visit they already filed.
 */
export default function InspectorError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <ErrorPanel
      title="Something went wrong"
      whatFailed="This page could not load. If you are in the field, this is most likely the connection rather than the app."
      stillWorks="Reports you have already submitted are saved. Nothing you filed has been lost, and you do not need to re-enter a visit."
      error={error}
      reset={reset}
    />
  );
}
