"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { useUrlState } from "@/lib/use-url-state";

export type PpaView = "table" | "map";

/** Segmented table/map toggle for the PPAs tab (Phase 12, Task: PPAs
 * table/map toggle). Preserves every other search param (filters, search
 * query) when switching views — only `view` changes. Built as a plain
 * two-button segmented control rather than pulling in a new
 * @radix-ui/react-toggle-group dependency for something this small. */
export function ViewToggle({ current }: { current: PpaView }) {
  const { isPending, setParam } = useUrlState("/manager/ppas");
  const [requested, setRequested] = useState<PpaView | null>(null);

  // Switching between a 2,393-row table and a clustered map is the heaviest
  // view change in the portal, and it rebuilds entirely on the server.
  function setView(view: PpaView) {
    setRequested(view);
    setParam("view", view);
  }

  return (
    <div className="inline-flex rounded-md border border-brand-navy/10 bg-white p-0.5">
      {(["table", "map"] as const).map((view) => (
        <button
          key={view}
          type="button"
          onClick={() => setView(view)}
          aria-current={current === view ? "true" : undefined}
          aria-busy={isPending && requested === view ? true : undefined}
          className={cn(
            "rounded px-3 py-1.5 text-sm font-medium capitalize transition-colors",
            current === view || (isPending && requested === view)
              ? "bg-brand-navy text-white"
              : "text-brand-navy/70 hover:bg-brand-surface",
            isPending && requested === view && "animate-pulse"
          )}
        >
          {view}
        </button>
      ))}
    </div>
  );
}
