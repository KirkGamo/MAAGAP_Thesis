"use client";

import { useEffect } from "react";

/**
 * Minimal reimplementation of Tremor Raw's internal useOnWindowResize hook
 * (its exact source wasn't fetchable -- GitHub's raw content host returned
 * an empty body for that specific file path when checked). This covers
 * the one thing BarChart.tsx actually needs from it: re-running a callback
 * (recomputing the legend's wrapped height) whenever the window resizes,
 * plus once on mount so the initial layout is measured correctly.
 */
export function useOnWindowResize(handler: () => void) {
  useEffect(() => {
    handler();
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
