"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Input } from "@/components/ui/input";

interface ReportsFiltersProps {
  inspectors: { id: string; full_name: string | null }[];
}

/** URL-search-param-driven filters for the Reports audit trail, same
 * pattern as PpaFilters/DayFilter -- shareable/bookmarkable, no
 * client-side data-fetching library needed. */
export function ReportsFilters({ inspectors }: ReportsFiltersProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(searchParams.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    router.push(`/manager/reports?${next.toString()}`);
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Input
        placeholder="Search by project name..."
        defaultValue={searchParams.get("q") ?? ""}
        onChange={(e) => setParam("q", e.target.value)}
        className="max-w-xs"
      />
      <select
        className="h-10 rounded-md border border-brand-navy/10 bg-white px-3 text-sm"
        defaultValue={searchParams.get("inspector") ?? ""}
        onChange={(e) => setParam("inspector", e.target.value)}
      >
        <option value="">All inspectors</option>
        {inspectors.map((inspector) => (
          <option key={inspector.id} value={inspector.id}>
            {inspector.full_name ?? "Unnamed"}
          </option>
        ))}
      </select>
    </div>
  );
}
