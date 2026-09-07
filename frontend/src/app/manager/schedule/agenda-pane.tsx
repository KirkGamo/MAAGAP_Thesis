import { Badge, riskTierVariant } from "@/components/ui/badge";
import { DAILY_CAPACITY, WEEKLY_CAPACITY } from "./capacity";

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

/**
 * The selected day's agenda: one group per inspector, one line per visit,
 * with day/week capacity chips against the optimizer's own staffing
 * assumptions (see capacity.ts). Deliberately one line per visit --
 * project, municipality, tier badge -- everything else lives a click away
 * (the edit popover, phase 2), which is what keeps a full 6-inspector,
 * 18-visit day inside the workspace's fixed pane.
 */
export function AgendaPane({ groups }: { groups: AgendaGroup[] }) {
  if (groups.length === 0) {
    return (
      <p className="p-4 text-center text-sm text-slate-400">
        No visits scheduled for this day.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
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
                <li
                  key={item.id}
                  className="flex items-center justify-between gap-2 rounded bg-brand-surface/60 px-2 py-1.5 text-xs"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-slate-800">
                      {item.projectName}
                    </span>
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
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
