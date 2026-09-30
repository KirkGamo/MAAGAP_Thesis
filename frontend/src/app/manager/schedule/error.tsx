"use client";

import { ErrorPanel } from "@/components/error-panel";

/**
 * The Schedule workspace both reads the latest solve from the ML service and
 * starts new ones, so it fails in two distinguishable ways. Neither prevents a
 * manager from seeing an already-deployed week, which is stored in Supabase
 * rather than fetched from the solver.
 */
export default function ScheduleError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <ErrorPanel
      title="Schedule"
      whatFailed="The optimizer output could not be loaded. A solve takes several minutes, so this can also mean one is still running."
      stillWorks="Any week already deployed — deployed visits are stored in the database and do not depend on the solver."
      error={error}
      reset={reset}
    />
  );
}
