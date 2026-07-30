"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { X } from "lucide-react";
import { STATUSES, parseCsvParam, PPA_FILTER_PARAM_KEYS } from "./filters";

interface Chip {
  id: string;
  label: string;
  onRemove: () => void;
}

/**
 * Phase 18: a removable-chip summary of every currently-applied PPAs
 * filter, per the user's explicit request to "show what are the active
 * filters" -- matching a reference dashboard's "ACTIVE FILTERS:" bar.
 * Rendered in page.tsx above the table/map card (not inside
 * data-table.tsx), so it's visible in both the table and map views --
 * filters apply to both, and the old placement inside the table's own
 * toolbar would have made it disappear on the map.
 *
 * Fully self-contained: reads/writes URL search params directly rather
 * than receiving state as props, same pattern ppa-filter-sidebar.tsx
 * already uses. Removing a single value from a multi-select facet (e.g.
 * one municipality out of three checked) only touches that one value, not
 * the whole param.
 */
export function PpaActiveFilters() {
  const router = useRouter();
  const searchParams = useSearchParams();

  function push(next: URLSearchParams) {
    next.delete("page");
    router.push(next.toString() ? `/manager/ppas?${next.toString()}` : "/manager/ppas");
  }

  function removeParams(...keys: string[]) {
    const next = new URLSearchParams(searchParams.toString());
    keys.forEach((k) => next.delete(k));
    push(next);
  }

  function removeCsvValue(key: string, value: string) {
    const remaining = parseCsvParam(searchParams.get(key) ?? undefined).filter((v) => v !== value);
    const next = new URLSearchParams(searchParams.toString());
    if (remaining.length > 0) next.set(key, remaining.join(","));
    else next.delete(key);
    push(next);
  }

  function clearAll() {
    const next = new URLSearchParams();
    const view = searchParams.get("view");
    const controls = searchParams.get("controls");
    if (view) next.set("view", view);
    if (controls) next.set("controls", controls);
    push(next);
  }

  const chips: Chip[] = [];

  const q = searchParams.get("q");
  if (q) chips.push({ id: "q", label: `Search: "${q}"`, onRemove: () => removeParams("q") });

  for (const status of parseCsvParam(searchParams.get("status") ?? undefined)) {
    const label = STATUSES.find((s) => s.value === status)?.label ?? status;
    chips.push({
      id: `status-${status}`,
      label: `Status: ${label}`,
      onRemove: () => removeCsvValue("status", status),
    });
  }
  for (const tier of parseCsvParam(searchParams.get("risk_tier") ?? undefined)) {
    chips.push({
      id: `risk_tier-${tier}`,
      label: `Risk Tier: ${tier}`,
      onRemove: () => removeCsvValue("risk_tier", tier),
    });
  }
  for (const type of parseCsvParam(searchParams.get("project_type") ?? undefined)) {
    chips.push({
      id: `project_type-${type}`,
      label: `Project Type: ${type}`,
      onRemove: () => removeCsvValue("project_type", type),
    });
  }
  for (const municipality of parseCsvParam(searchParams.get("municipality") ?? undefined)) {
    chips.push({
      id: `municipality-${municipality}`,
      label: `Municipality: ${municipality}`,
      onRemove: () => removeCsvValue("municipality", municipality),
    });
  }

  const revenueMin = searchParams.get("revenue_min");
  const revenueMax = searchParams.get("revenue_max");
  if (revenueMin || revenueMax) {
    chips.push({
      id: "revenue",
      label: `Budget: ₱${Number(revenueMin ?? 0).toLocaleString()}–${
        revenueMax ? `₱${Number(revenueMax).toLocaleString()}` : "max"
      }`,
      onRemove: () => removeParams("revenue_min", "revenue_max"),
    });
  }

  const riskMin = searchParams.get("risk_min");
  const riskMax = searchParams.get("risk_max");
  if (riskMin || riskMax) {
    chips.push({
      id: "risk_probability",
      label: `Risk Probability: ${riskMin ?? 0}%–${riskMax ?? 100}%`,
      onRemove: () => removeParams("risk_min", "risk_max"),
    });
  }

  const hasAnyFilter = PPA_FILTER_PARAM_KEYS.some((key) => searchParams.get(key));
  if (!hasAnyFilter || chips.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-brand-navy/10 bg-white px-4 py-2.5 shadow-md">
      <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">
        Active filters:
      </span>
      {chips.map((chip) => (
        <span
          key={chip.id}
          className="inline-flex items-center gap-1.5 rounded-full border border-brand-navy/10 bg-brand-surface px-2.5 py-1 text-xs text-brand-navy"
        >
          {chip.label}
          <button
            type="button"
            onClick={chip.onRemove}
            aria-label={`Remove filter: ${chip.label}`}
            className="text-slate-400 transition-colors hover:text-red-600"
          >
            <X className="size-3" aria-hidden="true" />
          </button>
        </span>
      ))}
      <button
        type="button"
        onClick={clearAll}
        className="ml-auto shrink-0 text-xs font-medium text-brand-blue hover:underline"
      >
        Clear all
      </button>
    </div>
  );
}
