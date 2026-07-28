import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, riskTierVariant } from "@/components/ui/badge";

export interface BoardAssignment {
  id: string;
  projectName: string;
  municipality: string | null;
  riskTier: string | null;
  cluster: string | null;
}

interface ScheduleBoardProps {
  days: readonly string[];
  boardByDay: Record<string, Record<string, BoardAssignment[]>>;
  colorByInspector: Map<string, string>;
}

/**
 * Phase 13: the Schedule tab's weekly deployment board -- Mon-Fri columns
 * (Kanban-style), each column grouping that day's assignments by
 * inspector. Replaces the old flat per-inspector card grid, which grouped
 * by inspector first and buried the day inside each card -- answering "what
 * does Wednesday look like across every inspector" meant scanning every
 * single card. This board makes that a single glance at one column, and
 * surfaces each inspector's per-day "risk load" via the same risk-tier
 * badges used everywhere else (Risk Map, PPAs table, Badge.riskTierVariant)
 * so a heavy Critical/High day for one inspector stands out immediately.
 *
 * The routing map and the "Adjust this week's schedule" editor (see
 * page.tsx) stay as separate sections above/below this board -- this is
 * an at-a-glance view, not the editing surface.
 */
export function ScheduleBoard({ days, boardByDay, colorByInspector }: ScheduleBoardProps) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
      {days.map((day) => {
        const inspectorsForDay = Object.entries(boardByDay[day] ?? {}).sort(([a], [b]) =>
          a.localeCompare(b)
        );
        const totalForDay = inspectorsForDay.reduce((sum, [, items]) => sum + items.length, 0);

        return (
          <Card key={day} className="flex flex-col p-0">
            <CardHeader className="border-b border-brand-navy/10 px-4 py-3">
              <CardTitle className="flex items-center justify-between text-sm">
                <span>{day}</span>
                <span className="text-xs font-normal text-slate-400">{totalForDay} visit(s)</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col gap-3 p-3">
              {inspectorsForDay.length === 0 && (
                <p className="p-2 text-center text-xs text-slate-400">No assignments</p>
              )}
              {inspectorsForDay.map(([inspectorName, items]) => (
                <div key={inspectorName} className="rounded-md border border-slate-100 p-2">
                  <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-slate-600">
                    <span
                      className="inline-block size-2.5 shrink-0 rounded-full"
                      style={{ background: colorByInspector.get(inspectorName) }}
                    />
                    <span className="truncate">{inspectorName}</span>
                  </div>
                  <ul className="flex flex-col gap-1.5">
                    {items.map((item) => (
                      <li key={item.id} className="rounded bg-brand-surface/60 p-1.5 text-xs">
                        <div className="flex items-center justify-between gap-1.5">
                          <span className="font-medium text-slate-800">{item.projectName}</span>
                          {item.riskTier && (
                            <Badge
                              variant={riskTierVariant(item.riskTier)}
                              className="shrink-0 px-1.5 py-0 text-[10px]"
                            >
                              {item.riskTier}
                            </Badge>
                          )}
                        </div>
                        <p className="text-slate-400">
                          {item.municipality ?? "—"}
                          {item.cluster ? ` · ${item.cluster}` : ""}
                        </p>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
