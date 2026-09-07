import { Card } from "@/components/tremor/card";
import { ActiveToggle } from "./active-toggle";
import { displayName, type SlotRow } from "./lib/roster";

/**
 * One optimizer roster slot. A filled slot shows who holds it and
 * whether they can sign in; an empty slot is drawn as a dashed
 * placeholder because it is a gap to close, not a neutral state -- work
 * the solver routes to it cannot be deployed to anyone.
 */
export function SlotCard({ row }: { row: SlotRow }) {
  const { slot, profile, inCurrentSolve } = row;

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
          <div className="mt-auto flex items-center justify-between gap-2 pt-1">
            <ActiveToggle profileId={profile.id} active={profile.active} />
          </div>
        </>
      ) : (
        <>
          <p className="text-sm font-medium text-slate-400">Unassigned</p>
          <p className="mt-auto pt-1 text-[11px] text-slate-400">
            No one receives this slot&apos;s visits.
          </p>
        </>
      )}
    </Card>
  );
}
