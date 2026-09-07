import { Card } from "@/components/tremor/card";
import { ActiveToggle } from "./active-toggle";
import { AssignSlotMenu, ClearSlotButton, type SlotCandidate } from "./assign-slot-menu";
import { DAILY_CAPACITY, WEEKLY_CAPACITY } from "../schedule/capacity";
import { displayName, WORKDAYS, type SlotRow, type WeekLoad } from "./lib/roster";

/**
 * One optimizer roster slot. A filled slot shows who holds it, whether
 * they can sign in, and their deployed load for the current week against
 * the solver's own capacity assumptions. An empty slot is drawn as a
 * dashed placeholder carrying the cost of leaving it empty -- how many
 * visits the latest solve routes to it that nobody will receive.
 *
 * The two numbers are deliberately different things: a filled slot's
 * load is what is DEPLOYED (inspector_schedules, this week), while an
 * empty slot's count is what the latest solve merely PROPOSES. Labels
 * say which.
 */
export function SlotCard({
  row,
  load,
  proposedVisits,
  solveKnown,
  candidates,
}: {
  row: SlotRow;
  load: WeekLoad | undefined;
  proposedVisits: number;
  solveKnown: boolean;
  /** Inspectors holding no slot, offered when filling this one. */
  candidates: SlotCandidate[];
}) {
  const { slot, profile, inCurrentSolve } = row;
  const total = load?.total ?? 0;
  const overWeekly = total > WEEKLY_CAPACITY;

  return (
    <Card
      className={
        "flex flex-col gap-1.5 p-3 " +
        (profile ? "" : "border-dashed border-brand-navy/25 bg-brand-surface/40 shadow-none")
      }
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate font-mono text-[11px] text-slate-500">{slot}</span>
        {!inCurrentSolve && (
          <span
            className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500"
            title="The optimizer's latest solve does not allocate work to this slot."
          >
            not in solve
          </span>
        )}
      </div>

      {profile ? (
        <>
          <p className="truncate text-sm font-medium text-slate-900">{displayName(profile)}</p>

          <div className="flex items-center gap-1">
            {WORKDAYS.map((day) => {
              const count = load?.days[day] ?? 0;
              const over = count > DAILY_CAPACITY;
              return (
                <span
                  key={day}
                  title={`${day}: ${count} of ${DAILY_CAPACITY}`}
                  className={
                    "flex h-5 flex-1 items-center justify-center rounded text-[10px] tabular-nums " +
                    (count === 0
                      ? "bg-slate-100 text-slate-300"
                      : over
                        ? "bg-orange-100 font-semibold text-orange-700"
                        : "bg-brand-surface font-medium text-brand-navy")
                  }
                >
                  {count === 0 ? "·" : count}
                </span>
              );
            })}
          </div>
          <p
            className={
              "text-[11px] " + (overWeekly ? "font-medium text-orange-600" : "text-slate-400")
            }
          >
            {`${total} of ${WEEKLY_CAPACITY} deployed this week`}
          </p>

          <div className="mt-auto flex flex-wrap items-center gap-1 pt-1">
            <ActiveToggle
              profileId={profile.id}
              active={profile.active}
              scheduledThisWeek={total}
            />
            <ClearSlotButton profileId={profile.id} />
          </div>
        </>
      ) : (
        <>
          <p className="text-sm font-medium text-slate-400">Unassigned</p>
          <p className="text-[11px] text-slate-500">
            {!solveKnown
              ? "No one receives this slot's visits."
              : proposedVisits > 0
                ? `${proposedVisits} visit${proposedVisits === 1 ? "" : "s"} in the latest solve cannot be deployed.`
                : "The latest solve routes no visits here."}
          </p>
          <div className="mt-auto pt-1">
            <AssignSlotMenu mode="fill-slot" slot={slot} candidates={candidates} label="Assign" />
          </div>
        </>
      )}
    </Card>
  );
}
