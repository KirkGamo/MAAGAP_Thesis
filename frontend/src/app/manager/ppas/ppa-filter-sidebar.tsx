"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import * as SliderPrimitive from "@radix-ui/react-slider";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { parseCsvParam, PPA_FILTER_PARAM_KEYS } from "./filters";

interface Bounds {
  min: number;
  max: number;
}

interface PpaFilterSidebarProps {
  riskTiers: readonly string[];
  statuses: readonly { value: string; label: string }[];
  projectTypes: readonly string[];
  municipalities: string[];
  revenueBounds: Bounds;
}

const RISK_PROBABILITY_BOUNDS: Bounds = { min: 0, max: 100 };

/**
 * Phase 16 built this as single-select pills; Phase 17 reworks it to match
 * a reference dashboard screenshot more closely: multi-select checkboxes
 * per facet (backed by filters.ts's comma-separated `.in()` query logic,
 * replacing the old single-value `.eq()` filters), plus two dual-handle
 * range sliders (Budget, Risk Probability) using @radix-ui/react-slider --
 * the reference's "Total Revenue"/"Headcount" sliders, mapped onto the two
 * numeric columns this schema actually has (amount_php, risk_probability).
 * Slider color is brand-blue rather than the reference's red, since red is
 * already this app's "Critical/danger" signal everywhere else (risk-tier
 * badges, the KPI header's Critical Risk Load figure) -- reusing it here
 * for a neutral filter control would misleadingly suggest something's
 * wrong.
 *
 * Revenue bounds come from a live MIN/MAX query in page.tsx (via two
 * cheap order+limit(1) queries, since PostgREST has no aggregate MIN/MAX
 * in a single .select()) rather than a guessed constant, so the slider's
 * range always matches what's actually in the database.
 *
 * Phase 18: sections reordered to Status / Risk Tier / Project Type /
 * Municipality / Budget / Risk Probability per explicit user request; adds
 * a "Reset" link next to the "Filters" heading (only shown once a filter
 * is active) that clears every PPA_FILTER_PARAM_KEYS param but preserves
 * `view`. See ppa-active-filters.tsx for the companion per-filter removable
 * chips + its own "Clear all".
 *
 * Phase 19: the "Filters" / Reset header row stays outside the scroll
 * region (always visible), while the section list below it fills whatever
 * space remains and scrolls internally.
 *
 * Phase 20: switched from matching the table/map card's height via
 * `lg:items-stretch` (flexbox stretch alignment) to a shared literal
 * height (`lg:h-[700px]`, also applied to both Card wrappers in page.tsx)
 * -- stretch alignment turned out to equalize toward whichever sibling's
 * own *natural, unconstrained* content height was tallest, so expanding
 * enough filter sections made the sidebar itself the tallest element and
 * it grew past the table/map instead of being capped by it. A shared
 * fixed height sidesteps that entirely: every section list here scrolls
 * internally (`overflow-y-auto`) once content exceeds the fixed budget,
 * so no amount of expanded sections can ever push the sidebar taller than
 * its siblings again. All filter sections also default to collapsed now
 * (see FilterSection's `defaultOpen`), so this only engages when a
 * Manager actually opens several sections at once.
 */
export function PpaFilterSidebar({
  riskTiers,
  statuses,
  projectTypes,
  municipalities,
  revenueBounds,
}: PpaFilterSidebarProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function setCsvParam(key: string, values: string[]) {
    const next = new URLSearchParams(searchParams.toString());
    if (values.length > 0) next.set(key, values.join(","));
    else next.delete(key);
    // Changing a filter can shrink the result set below the page the
    // Manager was on -- reset to page 1 rather than showing a confusing
    // "no projects match" for a page that no longer exists.
    next.delete("page");
    router.push(`/manager/ppas?${next.toString()}`);
  }

  function toggleCsvValue(key: string, value: string) {
    const active = new Set(parseCsvParam(searchParams.get(key) ?? undefined));
    if (active.has(value)) active.delete(value);
    else active.add(value);
    setCsvParam(key, Array.from(active));
  }

  // Preserves `view` (a display mode, not a filter) but drops every other
  // param, including `page` -- resetting filters always goes back to
  // page 1.
  function resetAll() {
    const next = new URLSearchParams();
    const view = searchParams.get("view");
    if (view) next.set("view", view);
    router.push(next.toString() ? `/manager/ppas?${next.toString()}` : "/manager/ppas");
  }

  const hasActiveFilters = PPA_FILTER_PARAM_KEYS.some((key) => searchParams.get(key));

  return (
    <aside className="flex w-full shrink-0 flex-col overflow-hidden rounded-xl border border-brand-navy/10 bg-white shadow-md lg:h-[700px] lg:w-64">
      <div className="flex shrink-0 items-center justify-between p-4 pb-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Filters</p>
        {hasActiveFilters && (
          <button
            type="button"
            onClick={resetAll}
            className="text-xs font-medium text-brand-blue hover:underline"
          >
            Reset
          </button>
        )}
      </div>

      {/* lg:flex-1 + lg:min-h-0 fills whatever's left of the <aside>'s
          fixed 700px at the lg breakpoint and scrolls internally once
          content overflows it. Below lg, the sidebar stacks above the
          table instead of sitting beside it, so it falls back to a plain
          cap instead of the same fixed value (700px would be excessive
          on a phone-width screen where everything is stacked). */}
      <div className="max-h-[420px] overflow-y-auto px-4 pb-4 lg:max-h-none lg:min-h-0 lg:flex-1">
        <CheckboxFilterSection
          title="Status"
          paramKey="status"
          options={statuses.map((s) => ({ value: s.value, label: s.label }))}
          selected={parseCsvParam(searchParams.get("status") ?? undefined)}
          onToggle={(v) => toggleCsvValue("status", v)}
        />
        <CheckboxFilterSection
          title="Risk Tier"
          paramKey="risk_tier"
          options={riskTiers.map((t) => ({ value: t, label: t }))}
          selected={parseCsvParam(searchParams.get("risk_tier") ?? undefined)}
          onToggle={(v) => toggleCsvValue("risk_tier", v)}
        />
        <CheckboxFilterSection
          title="Project Type"
          paramKey="project_type"
          options={projectTypes.map((t) => ({ value: t, label: t }))}
          selected={parseCsvParam(searchParams.get("project_type") ?? undefined)}
          onToggle={(v) => toggleCsvValue("project_type", v)}
        />
        <CheckboxFilterSection
          title="Municipality"
          paramKey="municipality"
          options={municipalities.map((m) => ({ value: m, label: m }))}
          selected={parseCsvParam(searchParams.get("municipality") ?? undefined)}
          onToggle={(v) => toggleCsvValue("municipality", v)}
          defaultOpen={false}
          scrollable
        />

        <RangeFilterSection
          title="Budget"
          paramMinKey="revenue_min"
          paramMaxKey="revenue_max"
          bounds={revenueBounds}
          step={1000}
          prefix="₱"
        />
        <RangeFilterSection
          title="Risk Probability"
          paramMinKey="risk_min"
          paramMaxKey="risk_max"
          bounds={RISK_PROBABILITY_BOUNDS}
          step={1}
          suffix="%"
        />
      </div>
    </aside>
  );
}

function FilterSection({
  title,
  children,
  defaultOpen = false,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
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
      {open && <div className="mt-3">{children}</div>}
    </div>
  );
}

function CheckboxFilterSection({
  title,
  options,
  selected,
  onToggle,
  defaultOpen = false,
  scrollable = false,
}: {
  title: string;
  paramKey: string;
  options: { value: string; label: string }[];
  selected: string[];
  onToggle: (value: string) => void;
  defaultOpen?: boolean;
  scrollable?: boolean;
}) {
  const selectedSet = new Set(selected);
  return (
    <FilterSection title={title} defaultOpen={defaultOpen}>
      <div className={cn("flex flex-col gap-2", scrollable && "max-h-56 overflow-y-auto pr-1")}>
        {options.map((opt) => (
          <label
            key={opt.value}
            className="flex cursor-pointer items-center gap-2 text-sm text-slate-600"
          >
            <input
              type="checkbox"
              checked={selectedSet.has(opt.value)}
              onChange={() => onToggle(opt.value)}
              className="size-3.5 rounded border-brand-navy/20 text-brand-blue focus:ring-2 focus:ring-brand-blue/40"
            />
            {opt.label}
          </label>
        ))}
        {options.length === 0 && <p className="text-xs text-slate-400">No options available.</p>}
      </div>
    </FilterSection>
  );
}

function RangeFilterSection({
  title,
  paramMinKey,
  paramMaxKey,
  bounds,
  step,
  prefix,
  suffix,
}: {
  title: string;
  paramMinKey: string;
  paramMaxKey: string;
  bounds: Bounds;
  step: number;
  prefix?: string;
  suffix?: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const urlMin = Number(searchParams.get(paramMinKey) ?? bounds.min);
  const urlMax = Number(searchParams.get(paramMaxKey) ?? bounds.max);
  const [range, setRange] = useState<[number, number]>([urlMin, urlMax]);

  // Keep local slider state in sync if the URL changes from elsewhere
  // (e.g. browser back/forward, or another control resetting filters).
  useEffect(() => {
    setRange([
      Number(searchParams.get(paramMinKey) ?? bounds.min),
      Number(searchParams.get(paramMaxKey) ?? bounds.max),
    ]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams.get(paramMinKey), searchParams.get(paramMaxKey)]);

  function commit(next: [number, number]) {
    const nextParams = new URLSearchParams(searchParams.toString());
    if (next[0] > bounds.min) nextParams.set(paramMinKey, String(next[0]));
    else nextParams.delete(paramMinKey);
    if (next[1] < bounds.max) nextParams.set(paramMaxKey, String(next[1]));
    else nextParams.delete(paramMaxKey);
    nextParams.delete("page");
    router.push(`/manager/ppas?${nextParams.toString()}`);
  }

  return (
    <FilterSection title={title}>
      <div className="flex items-center gap-2 pb-4">
        <NumberField
          label="Min."
          value={range[0]}
          prefix={prefix}
          suffix={suffix}
          onChange={(v) => setRange([Math.min(v, range[1]), range[1]])}
          onCommit={() => commit(range)}
        />
        <NumberField
          label="Max."
          value={range[1]}
          prefix={prefix}
          suffix={suffix}
          onChange={(v) => setRange([range[0], Math.max(v, range[0])])}
          onCommit={() => commit(range)}
        />
      </div>
      <SliderPrimitive.Root
        className="relative flex h-4 w-full touch-none select-none items-center"
        min={bounds.min}
        max={bounds.max}
        step={step}
        value={range}
        onValueChange={(v) => setRange([v[0], v[1]])}
        onValueCommit={(v) => commit([v[0], v[1]])}
      >
        <SliderPrimitive.Track className="relative h-1 w-full grow rounded-full bg-brand-navy/10">
          <SliderPrimitive.Range className="absolute h-full rounded-full bg-brand-blue" />
        </SliderPrimitive.Track>
        <SliderPrimitive.Thumb
          aria-label={`${title} minimum`}
          className="block size-4 rounded-full border-2 border-brand-blue bg-white shadow transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/40"
        />
        <SliderPrimitive.Thumb
          aria-label={`${title} maximum`}
          className="block size-4 rounded-full border-2 border-brand-blue bg-white shadow transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/40"
        />
      </SliderPrimitive.Root>
    </FilterSection>
  );
}

function NumberField({
  label,
  value,
  prefix,
  suffix,
  onChange,
  onCommit,
}: {
  label: string;
  value: number;
  prefix?: string;
  suffix?: string;
  onChange: (value: number) => void;
  onCommit: () => void;
}) {
  return (
    <div className="flex flex-1 flex-col gap-1">
      <span className="text-xs text-slate-400">{label}</span>
      <div className="flex items-center gap-1 rounded-md border border-brand-navy/10 bg-white px-2">
        {prefix && <span className="text-xs text-slate-400">{prefix}</span>}
        <input
          type="number"
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          onBlur={onCommit}
          onKeyDown={(e) => e.key === "Enter" && onCommit()}
          className="h-8 w-full min-w-0 bg-transparent text-sm text-slate-900 focus-visible:outline-none"
        />
        {suffix && <span className="text-xs text-slate-400">{suffix}</span>}
      </div>
    </div>
  );
}
