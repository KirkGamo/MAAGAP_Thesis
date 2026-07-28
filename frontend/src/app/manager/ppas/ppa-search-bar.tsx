"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";

/**
 * Phase 19: free-text search input, extracted out of data-table.tsx (where
 * it lived alone since Phase 16, per that file's own comment) so it can
 * also be rendered in the Map view's header -- the Map view previously had
 * no search input at all, since Phase 16's toolbar only rendered when
 * `view === "table"`. Both call sites rewrite the same `q` URL param, so
 * switching between table/map mid-search keeps the query intact.
 */
export function PpaSearchBar({ className }: { className?: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function setQuery(value: string) {
    const next = new URLSearchParams(searchParams.toString());
    if (value) next.set("q", value);
    else next.delete("q");
    next.delete("page");
    router.push(`/manager/ppas?${next.toString()}`);
  }

  return (
    <div className={className ?? "relative w-full max-w-sm"}>
      <Search
        className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400"
        aria-hidden="true"
      />
      <input
        type="text"
        placeholder="Search by project name..."
        defaultValue={searchParams.get("q") ?? ""}
        onChange={(e) => setQuery(e.target.value)}
        className="h-9 w-full rounded-md border border-brand-navy/10 bg-white pl-9 pr-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/40"
      />
    </div>
  );
}
