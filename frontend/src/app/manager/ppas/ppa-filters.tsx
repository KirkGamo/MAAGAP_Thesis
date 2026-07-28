"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Input } from "@/components/ui/input";

interface PpaFiltersProps {
  riskTiers: readonly string[];
  statuses: readonly { value: string; label: string }[];
}

/** Client-side filter bar that just rewrites the URL's search params — see
 * the PPAs page's Server Component for how those params drive the actual
 * Supabase query. Renamed from backlog-filters.tsx (Phase 12) but
 * otherwise unchanged; preserves the `view` param (table/map) so toggling
 * a filter doesn't silently reset which view the Manager was looking at. */
export function PpaFilters({ riskTiers, statuses }: PpaFiltersProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(searchParams.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    router.push(`/manager/ppas?${next.toString()}`);
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
        className="h-10 rounded-md border border-slate-200 bg-white px-3 text-sm"
        defaultValue={searchParams.get("risk_tier") ?? ""}
        onChange={(e) => setParam("risk_tier", e.target.value)}
      >
        <option value="">All risk tiers</option>
        {riskTiers.map((tier) => (
          <option key={tier} value={tier}>
            {tier}
          </option>
        ))}
      </select>
      <select
        className="h-10 rounded-md border border-slate-200 bg-white px-3 text-sm"
        defaultValue={searchParams.get("status") ?? ""}
        onChange={(e) => setParam("status", e.target.value)}
      >
        <option value="">All statuses</option>
        {statuses.map((s) => (
          <option key={s.value} value={s.value}>
            {s.label}
          </option>
        ))}
      </select>
    </div>
  );
}
