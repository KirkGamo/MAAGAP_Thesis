"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import * as Popover from "@radix-ui/react-popover";
import { Badge, riskTierVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { updateAssignment, removeAssignment } from "@/actions/schedule";
import { DAILY_CAPACITY, WEEKLY_CAPACITY } from "./capacity";
import { AddVisitDialog } from "./add-visit-dialog";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"] as const;

export interface AgendaItem {
  id: string;
  projectKey: string;
  projectName: string;
  municipality: string | null;
  riskTier: string | null;
  cluster: string | null;
}

export interface AgendaGroup {
  inspectorId: string;
  inspectorName: string;
  color: string;
  /** Visits for the selected day (the rendered items). */
  items: AgendaItem[];
  /** Visits across the whole week, for the weekly capacity chip. */
  weekCount: number;
}

export interface InspectorOption {
  id: string;
  name: string;
}

/** Per-inspector load across the week -- capacity math for chips,
 * annotated select options, and over-capacity warnings. */
export interface InspectorLoad {
  week: number;
  days: Record<string, number>;
}

interface AgendaPaneProps {
  groups: AgendaGroup[];
  inspectors: InspectorOption[];
  /** Always a workday here -- the "All" view renders WeekMatrix instead. */
  selectedDay: string;
  loadByInspector: Record<string, InspectorLoad>;
}

/**
 * The selected day's agenda: one group per inspector, one line per visit,
 * with day/week capacity chips against the optimizer's own staffing
 * assumptions (see capacity.ts). Each row is click-to-edit: a popover
 * offers reassign inspector / move day / remove, committing immediately
 * via the existing schedule actions (the codebase's established
 * commit-on-change pattern) -- EXCEPT when the chosen target is already
 * at capacity, where the change holds for an explicit "Apply anyway"
 * (warn-and-confirm, not hard-block: the caps are the solver's planning
 * assumptions, not laws -- see capacity.ts).
 *
 * This inline surface replaces the old always-visible schedule-editor
 * table; "Add visit" (top right) replaces its raw project-key input with
 * a searchable picker (add-visit-dialog.tsx).
 */
export function AgendaPane({ groups, inspectors, selectedDay, loadByInspector }: AgendaPaneProps) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] text-slate-400">Click a visit to reassign, move, or remove it.</p>
        <AddVisitDialog
          inspectors={inspectors}
          defaultDay={selectedDay}
          loadByInspector={loadByInspector}
        />
      </div>

      {groups.length === 0 && (
        <p className="p-4 text-center text-sm text-slate-400">
          No visits scheduled for this day.
        </p>
      )}

      {groups.map((group) => {
        const dayCount = group.items.length;
        const overDaily = dayCount > DAILY_CAPACITY;
        const overWeekly = group.weekCount > WEEKLY_CAPACITY;
        return (
          <div key={group.inspectorId} className="rounded-md border border-slate-100 p-2">
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-1.5 text-xs font-semibold text-slate-600">
                <span
                  className="inline-block size-2.5 shrink-0 rounded-full"
                  style={{ background: group.color }}
                />
                <span className="truncate">{group.inspectorName}</span>
              </span>
              <span className="flex shrink-0 items-center gap-1.5 text-[11px] tabular-nums">
                <span
                  className={overDaily ? "font-semibold text-orange-600" : "text-slate-400"}
                  title={`Visits this day vs. the optimizer's daily capacity of ${DAILY_CAPACITY}`}
                >
                  {dayCount}/{DAILY_CAPACITY} today
                </span>
                <span
                  className={overWeekly ? "font-semibold text-orange-600" : "text-slate-400"}
                  title={`Visits this week vs. the optimizer's weekly capacity of ${WEEKLY_CAPACITY}`}
                >
                  {group.weekCount}/{WEEKLY_CAPACITY} week
                </span>
              </span>
            </div>
            <ul className="flex flex-col gap-1">
              {group.items.map((item) => (
                <AssignmentRow
                  key={item.id}
                  item={item}
                  group={group}
                  inspectors={inspectors}
                  selectedDay={selectedDay}
                  loadByInspector={loadByInspector}
                />
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

function AssignmentRow({
  item,
  group,
  inspectors,
  selectedDay,
  loadByInspector,
}: {
  item: AgendaItem;
  group: AgendaGroup;
  inspectors: InspectorOption[];
  selectedDay: string;
  loadByInspector: Record<string, InspectorLoad>;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<{
    message: string;
    patch: { inspectorId?: string; scheduledDay?: string };
  } | null>(null);
  // Controlled selects so a warned-but-unconfirmed choice can be rolled
  // back by Cancel.
  const [inspectorSel, setInspectorSel] = useState(group.inspectorId);
  const [daySel, setDaySel] = useState(selectedDay);

  function dayLoad(inspectorId: string, day: string): number {
    return loadByInspector[inspectorId]?.days[day] ?? 0;
  }

  function commit(patch: { inspectorId?: string; scheduledDay?: string }) {
    setError(null);
    setWarning(null);
    startTransition(async () => {
      const res = await updateAssignment(item.id, patch);
      if (res.success) {
        router.refresh();
      } else {
        setError(res.error);
        setInspectorSel(group.inspectorId);
        setDaySel(selectedDay);
      }
    });
  }

  function requestInspectorChange(targetId: string) {
    setInspectorSel(targetId);
    const target = inspectors.find((i) => i.id === targetId);
    const load = dayLoad(targetId, selectedDay);
    const weekLoad = loadByInspector[targetId]?.week ?? 0;
    if (load >= DAILY_CAPACITY) {
      setWarning({
        message: `${target?.name ?? "That inspector"} already has ${load}/${DAILY_CAPACITY} visits on ${selectedDay}.`,
        patch: { inspectorId: targetId },
      });
    } else if (weekLoad >= WEEKLY_CAPACITY) {
      setWarning({
        message: `${target?.name ?? "That inspector"} already has ${weekLoad}/${WEEKLY_CAPACITY} visits this week.`,
        patch: { inspectorId: targetId },
      });
    } else {
      commit({ inspectorId: targetId });
    }
  }

  function requestDayChange(targetDay: string) {
    setDaySel(targetDay);
    const load = dayLoad(group.inspectorId, targetDay);
    if (load >= DAILY_CAPACITY) {
      setWarning({
        message: `${group.inspectorName} already has ${load}/${DAILY_CAPACITY} visits on ${targetDay}.`,
        patch: { scheduledDay: targetDay },
      });
    } else {
      commit({ scheduledDay: targetDay });
    }
  }

  function cancelWarning() {
    setWarning(null);
    setInspectorSel(group.inspectorId);
    setDaySel(selectedDay);
  }

  function handleRemove() {
    setError(null);
    startTransition(async () => {
      const res = await removeAssignment(item.id);
      if (res.success) {
        router.refresh();
      } else {
        setError(res.error);
      }
    });
  }

  return (
    <li>
      <Popover.Root>
        <Popover.Trigger asChild>
          <button
            type="button"
            className="flex w-full items-center justify-between gap-2 rounded bg-brand-surface/60 px-2 py-1.5 text-left text-xs transition-colors hover:bg-brand-surface"
          >
            <span className="min-w-0">
              <span className="block truncate font-medium text-slate-800">{item.projectName}</span>
              <span className="block truncate text-[11px] text-slate-400">
                {item.municipality ?? "—"}
                {item.cluster ? ` · ${item.cluster}` : ""}
              </span>
            </span>
            {item.riskTier && (
              <Badge
                variant={riskTierVariant(item.riskTier)}
                className="shrink-0 px-1.5 py-0 text-[10px]"
              >
                {item.riskTier}
              </Badge>
            )}
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          {/* z-1200: above Leaflet's z-1000 controls (see ui/sheet.tsx's
              stacking-context note). */}
          <Popover.Content
            side="left"
            align="start"
            sideOffset={6}
            className="z-1200 w-64 rounded-md border border-brand-navy/10 bg-white p-3 shadow-lg"
          >
            <p className="truncate text-xs font-semibold text-slate-700">{item.projectName}</p>
            <p className="mb-2 text-[11px] text-slate-400">{item.projectKey}</p>

            <label className="mb-1 block text-[11px] font-medium text-slate-500">Inspector</label>
            <select
              className="mb-2 h-8 w-full rounded-md border border-brand-navy/10 px-2 text-sm"
              value={inspectorSel}
              disabled={isPending}
              onChange={(e) => requestInspectorChange(e.target.value)}
            >
              {!inspectors.some((i) => i.id === group.inspectorId) && (
                <option value={group.inspectorId}>{group.inspectorName}</option>
              )}
              {inspectors.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name} · {dayLoad(i.id, selectedDay)}/{DAILY_CAPACITY} {selectedDay}
                </option>
              ))}
            </select>

            <label className="mb-1 block text-[11px] font-medium text-slate-500">Day</label>
            <select
              className="mb-2 h-8 w-full rounded-md border border-brand-navy/10 px-2 text-sm"
              value={daySel}
              disabled={isPending}
              onChange={(e) => requestDayChange(e.target.value)}
            >
              {DAYS.map((d) => (
                <option key={d} value={d}>
                  {d} · {dayLoad(group.inspectorId, d)}/{DAILY_CAPACITY}
                </option>
              ))}
            </select>

            {warning && (
              <div className="mb-2 rounded-md border border-orange-200 bg-orange-50 p-2 text-[11px] text-orange-700">
                <p>{warning.message}</p>
                <div className="mt-1.5 flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 px-2 text-[11px]"
                    disabled={isPending}
                    onClick={() => commit(warning.patch)}
                  >
                    Apply anyway
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 px-2 text-[11px]"
                    disabled={isPending}
                    onClick={cancelWarning}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}

            {error && <p className="mb-2 text-[11px] text-red-600">{error}</p>}

            <Button
              size="sm"
              variant="outline"
              className="h-7 w-full text-xs text-red-600 hover:bg-red-50"
              disabled={isPending}
              onClick={handleRemove}
            >
              {isPending ? "Working…" : "Remove visit"}
            </Button>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </li>
  );
}
