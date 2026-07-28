"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";

export type PpaView = "table" | "map";

/** Segmented table/map toggle for the PPAs tab (Phase 12, Task: PPAs
 * table/map toggle). Preserves every other search param (filters, search
 * query) when switching views — only `view` changes. Built as a plain
 * two-button segmented control rather than pulling in a new
 * @radix-ui/react-toggle-group dependency for something this small. */
export function ViewToggle({ current }: { current: PpaView }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function setView(view: PpaView) {
    const next = new URLSearchParams(searchParams.toString());
    next.set("view", view);
    router.push(`/manager/ppas?${next.toString()}`);
  }

  return (
    <div className="inline-flex rounded-md border border-brand-navy/10 bg-white p-0.5">
      {(["table", "map"] as const).map((view) => (
        <button
          key={view}
          type="button"
          onClick={() => setView(view)}
          className={cn(
            "rounded px-3 py-1.5 text-sm font-medium capitalize transition-colors",
            current === view
              ? "bg-brand-navy text-white"
              : "text-brand-navy/70 hover:bg-brand-surface"
          )}
        >
          {view}
        </button>
      ))}
    </div>
  );
}
