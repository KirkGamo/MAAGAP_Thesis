"use client";

import { ErrorPanel } from "@/components/error-panel";

/**
 * The Models tab reads validation metrics straight from the ML service, so it
 * is the page most likely to fail alone — and the one where a user can be told
 * exactly that, rather than being left to guess.
 *
 * The page's own no-service path already degrades gracefully; this catches what
 * that path cannot, such as a malformed artifact or a fetch that throws rather
 * than returning a status.
 */
export default function ModelsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <ErrorPanel
      title="Models"
      whatFailed="Validation metrics could not be read from the ML service. It may be restarting, or it may not have been trained yet."
      stillWorks="Every other manager page — project data comes from the database, not the ML service."
      error={error}
      reset={reset}
    />
  );
}
