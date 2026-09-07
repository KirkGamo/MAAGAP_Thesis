"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge, riskTierVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  addAssignment,
  searchProjects,
  type ProjectSearchResult,
} from "@/actions/schedule";
import { DAILY_CAPACITY, WEEKLY_CAPACITY } from "./capacity";
import type { InspectorOption, InspectorLoad } from "./agenda-pane";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"] as const;

interface AddVisitDialogProps {
  inspectors: InspectorOption[];
  /** Prefilled from the workspace's selected day. */
  defaultDay: string;
  loadByInspector: Record<string, InspectorLoad>;
}

/**
 * "Add visit": a searchable project picker in a slide-over Sheet --
 * replaces the old raw project-key input (which required reading keys off
 * the PPAs tab) with search-by-name-or-municipality backed by
 * actions/schedule.ts's searchProjects, riskiest results first. Inspector
 * and day selects are annotated with current load; an at-capacity choice
 * warns and requires an explicit "Add anyway" (same warn-and-confirm
 * stance as the agenda popover -- see capacity.ts).
 */
export function AddVisitDialog({ inspectors, defaultDay, loadByInspector }: AddVisitDialogProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ProjectSearchResult[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [selected, setSelected] = useState<ProjectSearchResult | null>(null);
  const [inspectorId, setInspectorId] = useState(inspectors[0]?.id ?? "");
  const [day, setDay] = useState(defaultDay);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState<string | null>(null);

  // Debounced search: schedule a lookup 300ms after the last keystroke.
  useEffect(() => {
    setSearchError(null);
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    const handle = setTimeout(async () => {
      const res = await searchProjects(query);
      if (res.success) setResults(res.results);
      else setSearchError(res.error);
    }, 300);
    return () => clearTimeout(handle);
  }, [query]);

  const dayLoad = loadByInspector[inspectorId]?.days[day] ?? 0;
  const weekLoad = loadByInspector[inspectorId]?.week ?? 0;
  const overCapacity = dayLoad >= DAILY_CAPACITY || weekLoad >= WEEKLY_CAPACITY;

  function handleAdd() {
    if (!selected) return;
    setSubmitError(null);
    setSubmitSuccess(null);
    startTransition(async () => {
      const res = await addAssignment({
        projectKey: selected.projectKey,
        inspectorId,
        scheduledDay: day,
      });
      if (res.success) {
        setSubmitSuccess(res.message ?? "Added.");
        setSelected(null);
        setQuery("");
        setResults([]);
        router.refresh();
      } else {
        setSubmitError(res.error);
      }
    });
  }

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button size="sm" variant="outline" className="h-7 px-2.5 text-xs">
          + Add visit
        </Button>
      </SheetTrigger>
      <SheetContent className="sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Add a visit</SheetTitle>
          <SheetDescription>
            Search by project name or municipality — riskiest matches first.
          </SheetDescription>
        </SheetHeader>
        <SheetBody className="flex flex-col gap-3">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="e.g. flood control, Leon…"
            className="h-9 text-sm"
          />
          {searchError && <p className="text-xs text-red-600">{searchError}</p>}

          {selected ? (
            <div className="flex items-center justify-between gap-2 rounded-md border border-brand-navy/15 bg-brand-surface/60 p-2 text-sm">
              <span className="min-w-0">
                <span className="block truncate font-medium text-slate-800">{selected.name}</span>
                <span className="block truncate text-xs text-slate-400">
                  {selected.projectKey}
                  {selected.municipality ? ` · ${selected.municipality}` : ""}
                </span>
              </span>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 shrink-0 px-2 text-xs"
                onClick={() => setSelected(null)}
              >
                Change
              </Button>
            </div>
          ) : (
            <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto">
              {results.map((result) => (
                <li key={result.projectKey}>
                  <button
                    type="button"
                    onClick={() => {
                      setSelected(result);
                      setSubmitSuccess(null);
                    }}
                    className="flex w-full items-center justify-between gap-2 rounded-md border border-slate-100 px-2 py-1.5 text-left text-sm transition-colors hover:bg-brand-surface"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-slate-800">
                        {result.name}
                      </span>
                      <span className="block truncate text-xs text-slate-400">
                        {result.projectKey}
                        {result.municipality ? ` · ${result.municipality}` : ""}
                      </span>
                    </span>
                    {result.riskTier && (
                      <Badge
                        variant={riskTierVariant(result.riskTier)}
                        className="shrink-0 px-1.5 py-0 text-[10px]"
                      >
                        {result.riskTier}
                      </Badge>
                    )}
                  </button>
                </li>
              ))}
              {query.trim().length >= 2 && results.length === 0 && !searchError && (
                <li className="p-2 text-center text-xs text-slate-400">No matches.</li>
              )}
            </ul>
          )}

          {selected && (
            <>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="mb-1 block text-[11px] font-medium text-slate-500">
                    Inspector
                  </label>
                  <select
                    className="h-8 w-full rounded-md border border-brand-navy/10 px-2 text-sm"
                    value={inspectorId}
                    onChange={(e) => setInspectorId(e.target.value)}
                  >
                    {inspectors.length === 0 && <option value="">No active inspectors</option>}
                    {inspectors.map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.name} · {loadByInspector[i.id]?.week ?? 0}/{WEEKLY_CAPACITY} wk
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-medium text-slate-500">Day</label>
                  <select
                    className="h-8 w-full rounded-md border border-brand-navy/10 px-2 text-sm"
                    value={day}
                    onChange={(e) => setDay(e.target.value)}
                  >
                    {DAYS.map((d) => (
                      <option key={d} value={d}>
                        {d} · {loadByInspector[inspectorId]?.days[d] ?? 0}/{DAILY_CAPACITY}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {overCapacity && (
                <p className="rounded-md border border-orange-200 bg-orange-50 p-2 text-[11px] text-orange-700">
                  This assignment exceeds the optimizer&apos;s capacity assumption (
                  {dayLoad}/{DAILY_CAPACITY} that day, {weekLoad}/{WEEKLY_CAPACITY} that week) —
                  adding is allowed, but consider another inspector or day.
                </p>
              )}

              <Button
                size="sm"
                disabled={isPending || !inspectorId}
                onClick={handleAdd}
                className="self-start"
              >
                {isPending ? "Adding…" : overCapacity ? "Add anyway" : "Add visit"}
              </Button>
            </>
          )}

          {submitError && <p className="text-xs text-red-600">{submitError}</p>}
          {submitSuccess && <p className="text-xs text-emerald-700">{submitSuccess}</p>}
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}
