"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";

/**
 * Phase 16: free-text search bar living inside the table/map card header,
 * matching the reference dashboard's "Search across all table fields..."
 * placement (inside the content card, next to the row-count) rather than
 * in a filter bar above it. Splits out of the old ppa-filters.tsx, which
 * combined this with the risk_tier/status <select>s now in
 * ppa-filter-sidebar.tsx.
 */
export function PpaSearchBar({ totalCount }: { totalCount: number }) {
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
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-brand-navy/10 px-5 py-3">
      <div className="relative w-full max-w-sm">
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
      <span className="shrink-0 text-sm text-slate-500">{totalCount.toLocaleString()} project(s)</span>
    </div>
  );
}
