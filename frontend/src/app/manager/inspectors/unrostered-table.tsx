import { ActiveToggle } from "./active-toggle";
import { AssignSlotMenu } from "./assign-slot-menu";
import { displayName, type InspectorProfile } from "./lib/roster";

/**
 * Inspectors who hold no optimizer slot. Kept out of the slot grid on
 * purpose: the grid is bounded by the solver's roster size and stays
 * scannable, while this table absorbs however many accounts exist and
 * owns its own scroll region.
 *
 * Each row can be given a slot from here as well as from an empty slot
 * card -- the same assignment reached from whichever side the Manager
 * happens to be looking at.
 */
export function UnrosteredTable({
  profiles,
  slots,
  occupiedSlots,
}: {
  profiles: InspectorProfile[];
  slots: string[];
  occupiedSlots: string[];
}) {
  if (profiles.length === 0) {
    return (
      <p className="px-1 py-2 text-[11px] text-slate-400">
        Every inspector account holds an optimizer slot.
      </p>
    );
  }

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-brand-navy/10 text-left text-[11px] text-slate-500">
          <th className="py-1.5 pr-2 font-medium">Name</th>
          <th className="px-2 py-1.5 font-medium">Joined</th>
          <th className="py-1.5 pl-2 text-right font-medium">Status</th>
        </tr>
      </thead>
      <tbody>
        {profiles.map((profile) => (
          <tr key={profile.id} className="border-b border-slate-100 last:border-0">
            <td className="max-w-40 py-1.5 pr-2">
              <span className="block truncate font-medium text-slate-800">
                {displayName(profile)}
              </span>
              <span className="mt-1 inline-block">
                <AssignSlotMenu
                  mode="set-person-slot"
                  profileId={profile.id}
                  slots={slots}
                  occupiedSlots={occupiedSlots}
                  label="Assign slot"
                />
              </span>
            </td>
            <td className="px-2 py-1.5 align-top text-xs text-slate-500">
              {new Date(profile.created_at).toLocaleDateString()}
            </td>
            <td className="py-1.5 pl-2 text-right align-top">
              <ActiveToggle profileId={profile.id} active={profile.active} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
