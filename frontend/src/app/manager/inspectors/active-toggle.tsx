"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import * as Popover from "@radix-ui/react-popover";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toggleInspectorActive } from "@/actions/inspectors";

/**
 * Activate/deactivate an inspector account. Deactivating is guarded when
 * the person still holds visits this week: they immediately lose the
 * ability to sign in, but their `inspector_schedules` rows stay exactly
 * where they are -- nothing reassigns them. That asymmetry is easy to
 * get wrong from the button alone, so the confirmation states it rather
 * than implying a cleanup that does not happen (unassigning is the
 * Schedule tab's job).
 *
 * Activating is never guarded -- it takes nothing away.
 */
export function ActiveToggle({
  profileId,
  active,
  scheduledThisWeek = 0,
}: {
  profileId: string;
  active: boolean;
  /** Visits this inspector holds for the current week. */
  scheduledThisWeek?: number;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);

  function commit() {
    startTransition(async () => {
      const res = await toggleInspectorActive(profileId, !active);
      setConfirming(false);
      if (res.success) router.refresh();
      // Errors here are rare (RLS-denied writes would only happen if the
      // signed-in user's own role changed mid-session) -- not worth a
      // dedicated error UI for this button; a failed toggle simply leaves
      // the row unchanged on refresh.
    });
  }

  function handleClick() {
    if (active && scheduledThisWeek > 0) {
      setConfirming(true);
      return;
    }
    commit();
  }

  const warning =
    `${scheduledThisWeek} visit${scheduledThisWeek === 1 ? "" : "s"} scheduled this week ` +
    "stay assigned to them and will not be reassigned. They just lose access to sign in.";

  return (
    <Popover.Root open={confirming} onOpenChange={setConfirming}>
      <Popover.Trigger asChild>
        <button
          type="button"
          onClick={handleClick}
          disabled={isPending}
          className={cn(
            "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors disabled:opacity-50",
            active
              ? "border-transparent bg-emerald-100 text-emerald-800 hover:bg-emerald-200"
              : "border-transparent bg-slate-100 text-slate-600 hover:bg-slate-200"
          )}
        >
          {isPending ? "Updating..." : active ? "Active" : "Inactive"}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="bottom"
          align="start"
          sideOffset={6}
          className="z-1200 w-60 rounded-md border border-orange-200 bg-orange-50 p-3 shadow-lg"
        >
          <p className="text-[11px] leading-relaxed text-orange-800">{warning}</p>
          <div className="mt-2 flex gap-2">
            <Button
              size="sm"
              variant="outline"
              className="h-6 px-2 text-[11px]"
              disabled={isPending}
              onClick={commit}
            >
              Deactivate anyway
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-[11px]"
              disabled={isPending}
              onClick={() => setConfirming(false)}
            >
              Cancel
            </Button>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
