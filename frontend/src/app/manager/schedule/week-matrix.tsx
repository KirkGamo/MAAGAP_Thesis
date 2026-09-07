import Link from "next/link";

export interface WeekMatrixCell {
  count: number;
  critical: number;
  high: number;
}

export interface WeekMatrixRow {
  inspectorName: string;
  color: string;
  /** Keyed by workday ("Mon".."Fri"). */
  cells: Record<string, WeekMatrixCell>;
  weekTotal: number;
}

/**
 * The "All" day view of the schedule workspace's right pane: a compact
 * inspector x day count matrix with Critical/High presence dots. This is
 * the information-overload-safe replacement for the old five-column
 * Kanban board (schedule-board.tsx), which rendered every project card
 * for every inspector for every day at once (~90 cards worst case). The
 * matrix answers the board's question -- "how is the week distributed?"
 * -- in numbers, and each day header links into that day's full agenda
 * for the detail.
 */
export function WeekMatrix({ days, rows }: { days: readonly string[]; rows: WeekMatrixRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="p-4 text-center text-sm text-slate-400">
        No assignments this week yet.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-brand-navy/10 text-left text-xs text-slate-500">
            <th className="py-2 pr-2 font-medium">Inspector</th>
            {days.map((day) => (
              <th key={day} className="px-2 py-2 text-center font-medium">
                <Link
                  href={`/manager/schedule?day=${day}`}
                  className="rounded px-1.5 py-0.5 text-brand-navy/80 underline-offset-2 hover:bg-brand-surface hover:underline"
                >
                  {day}
                </Link>
              </th>
            ))}
            <th className="py-2 pl-2 text-right font-medium">Week</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.inspectorName} className="border-b border-slate-100 last:border-0">
              <td className="max-w-36 py-2 pr-2">
                <span className="flex items-center gap-1.5">
                  <span
                    className="inline-block size-2.5 shrink-0 rounded-full"
                    style={{ background: row.color }}
                  />
                  <span className="truncate font-medium text-slate-700">{row.inspectorName}</span>
                </span>
              </td>
              {days.map((day) => {
                const cell = row.cells[day];
                return (
                  <td key={day} className="px-2 py-2 text-center">
                    {cell && cell.count > 0 ? (
                      <span className="inline-flex items-center gap-1 tabular-nums text-slate-700">
                        {cell.count}
                        {cell.critical > 0 && (
                          <span
                            className="size-1.5 rounded-full bg-red-500"
                            title={`${cell.critical} Critical`}
                          />
                        )}
                        {cell.high > 0 && (
                          <span
                            className="size-1.5 rounded-full bg-orange-500"
                            title={`${cell.high} High`}
                          />
                        )}
                      </span>
                    ) : (
                      <span className="text-slate-300">·</span>
                    )}
                  </td>
                );
              })}
              <td className="py-2 pl-2 text-right tabular-nums text-slate-500">{row.weekTotal}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
