"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface PpaFilterSidebarProps {
  riskTiers: readonly string[];
  statuses: readonly { value: string; label: string }[];
}

/**
 * Phase 16: dedicated left filter panel for the PPAs tab, replacing the
 * inline `<select>`s that used to sit in a top filter bar (ppa-filters.tsx,
 * now removed) -- matching the reference dashboard's "FILTERS" sidebar
 * pattern the user asked for. Free-text search moved to ppa-search-bar.tsx,
 * inside the table/map card itself, since it's a different kind of filter
 * (searches text, doesn't facet a fixed set of values) and the reference
 * keeps it there too.
 *
 * Still just rewrites URL search params -- risk_tier/status stay
 * single-select (matching the Supabase .eq() query in page.tsx), rendered
 * as a vertical pill list rather than a <select>, not real multi-select
 * checkboxes like the reference's facets. Multi-select would need
 * .in(...) query changes; out of scope for a visual pass.
 */
export function PpaFilterSidebar({ riskTiers, statuses }: PpaFilterSidebarProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeRiskTier = searchParams.get("risk_tier") ?? "";
  const activeStatus = searchParams.get("status") ?? "";

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(searchParams.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    // Changing a filter can shrink the result set below the page the
    // Manager was on -- reset to page 1 rather than showing a confusing
    // "no projects match" for a page that no longer exists.
    next.delete("page");
    router.push(`/manager/ppas?${next.toString()}`);
  }

  return (
    <aside className="w-full shrink-0 rounded-xl border border-brand-navy/10 bg-white p-4 shadow-md lg:w-56">
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Filters</p>
      <FilterSection title="Risk Tier">
        <FilterPill label="All tiers" active={!activeRiskTier} onClick={() => setParam("risk_tier", "")} />
        {riskTiers.map((tier) => (
          <FilterPill
            key={tier}
            label={tier}
            active={activeRiskTier === tier}
            onClick={() => setParam("risk_tier", tier)}
          />
        ))}
      </FilterSection>
      <FilterSection title="Status">
        <FilterPill label="All statuses" active={!activeStatus} onClick={() => setParam("status", "")} />
        {statuses.map((s) => (
          <FilterPill
            key={s.value}
            label={s.label}
            active={activeStatus === s.value}
            onClick={() => setParam("status", s.value)}
          />
        ))}
      </FilterSection>
    </aside>
  );
}

function FilterSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className="border-b border-brand-navy/10 py-3 last:border-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between text-left text-sm font-medium text-brand-navy"
      >
        {title}
        {open ? (
          <ChevronDown className="size-4 text-slate-400" aria-hidden="true" />
        ) : (
          <ChevronRight className="size-4 text-slate-400" aria-hidden="true" />
        )}
      </button>
      {open && <div className="mt-2 flex flex-col gap-0.5">{children}</div>}
    </div>
  );
}

function FilterPill({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-md px-2 py-1.5 text-left text-sm transition-colors",
        active ? "bg-brand-blue/10 font-medium text-brand-navy" : "text-slate-600 hover:bg-brand-surface"
      )}
    >
      {label}
    </button>
  );
}
