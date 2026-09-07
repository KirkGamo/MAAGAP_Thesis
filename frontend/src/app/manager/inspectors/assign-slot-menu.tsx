"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import * as Popover from "@radix-ui/react-popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { setInspectorSlug } from "@/actions/inspectors";

export interface SlotCandidate {
  id: string;
  name: string;
}

interface AssignSlotMenuProps {
  /** Filling a named slot with a person, or giving a person a slot. */
  mode: "fill-slot" | "set-person-slot";
  /** mode "fill-slot": the slot being filled. */
  slot?: string;
  /** mode "set-person-slot": the person being given a slot. */
  profileId?: string;
  /** Inspectors holding no slot, offered when filling a slot. */
  candidates?: SlotCandidate[];
  /** Known slots, offered when setting a person's slot. */
  slots?: string[];
  /** Slots already held by someone -- offered but marked, since the
   * unique constraint will reject them. */
  occupiedSlots?: string[];
  label: string;
  triggerClassName?: string;
}

/**
 * The Inspectors tab's one editing surface, revealed on click. Replaces
 * the free-text slug input plus Save button that used to sit on every
 * table row at rest -- the same always-on editing noise the Schedule tab
 * removed.
 *
 * Both directions commit through the existing setInspectorSlug action,
 * which already translates a unique-constraint violation into "that slot
 * is taken" rather than a raw Postgres error. The free-text fallback in
 * "set-person-slot" exists for the offline case: with the ML service
 * unreachable the known-slot list can be empty, and a Manager must still
 * be able to type the slug the optimizer will use.
 */
export function AssignSlotMenu({
  mode,
  slot,
  profileId,
  candidates = [],
  slots = [],
  occupiedSlots = [],
  label,
  triggerClassName,
}: AssignSlotMenuProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [customSlot, setCustomSlot] = useState("");
  const [open, setOpen] = useState(false);

  function commit(targetProfileId: string, targetSlot: string) {
    setError(null);
    startTransition(async () => {
      const res = await setInspectorSlug(targetProfileId, targetSlot);
      if (res.success) {
        setOpen(false);
        setCustomSlot("");
        router.refresh();
      } else {
        setError(res.error);
      }
    });
  }

  const occupied = new Set(occupiedSlots);

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <Button
          size="sm"
          variant="outline"
          className={triggerClassName ?? "h-6 px-2 text-[11px]"}
        >
          {label}
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        {/* z-1200: above Leaflet's z-1000 controls, matching the
            convention set in ui/sheet.tsx and the schedule agenda. */}
        {/* align="start" + collisionPadding: the menu opens rightward
            from the trigger and Radix flips it back inside the viewport
            near the right edge, instead of extending left across the
            sidebar as end-alignment did. */}
        <Popover.Content
          side="bottom"
          align="start"
          sideOffset={6}
          collisionPadding={12}
          className="z-1200 w-60 rounded-md border border-brand-navy/10 bg-white p-3 shadow-lg"
        >
          {mode === "fill-slot" ? (
            <>
              <p className="mb-2 text-[11px] font-medium text-slate-500">
                {`Assign someone to ${slot}`}
              </p>
              {candidates.length > 0 ? (
                <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto">
                  {candidates.map((candidate) => (
                    <li key={candidate.id}>
                      <button
                        type="button"
                        disabled={isPending}
                        onClick={() => commit(candidate.id, slot ?? "")}
                        className="w-full truncate rounded px-2 py-1.5 text-left text-sm text-slate-700 transition-colors hover:bg-brand-surface disabled:opacity-50"
                      >
                        {candidate.name}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[11px] text-slate-400">
                  Every inspector already holds a slot. Invite someone new to fill this one.
                </p>
              )}
            </>
          ) : (
            <>
              <p className="mb-2 text-[11px] font-medium text-slate-500">Assign an optimizer slot</p>
              {slots.length > 0 && (
                <ul className="mb-2 flex max-h-40 flex-col gap-1 overflow-y-auto">
                  {slots.map((option) => (
                    <li key={option}>
                      <button
                        type="button"
                        disabled={isPending || occupied.has(option)}
                        onClick={() => commit(profileId ?? "", option)}
                        className="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left font-mono text-xs text-slate-700 transition-colors hover:bg-brand-surface disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <span className="truncate">{option}</span>
                        {occupied.has(option) && (
                          <span className="shrink-0 font-sans text-[10px] text-slate-400">taken</span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex items-center gap-1.5">
                <Input
                  value={customSlot}
                  onChange={(e) => setCustomSlot(e.target.value)}
                  placeholder="e.g. Inspector_2"
                  className="h-7 flex-1 text-xs"
                />
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 px-2 text-[11px]"
                  disabled={isPending || !customSlot.trim()}
                  onClick={() => commit(profileId ?? "", customSlot)}
                >
                  Set
                </Button>
              </div>
            </>
          )}

          {error && <p className="mt-2 text-[11px] text-red-600">{error}</p>}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/**
 * Releases a slot without deactivating the person -- they stay an
 * inspector, they just stop receiving the optimizer's routed work.
 */
export function ClearSlotButton({ profileId }: { profileId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      size="sm"
      variant="ghost"
      className="h-6 px-2 text-[11px] text-slate-500"
      disabled={isPending}
      onClick={() =>
        startTransition(async () => {
          const res = await setInspectorSlug(profileId, "");
          if (res.success) router.refresh();
        })
      }
    >
      {isPending ? "Clearing…" : "Clear slot"}
    </Button>
  );
}
