"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { toggleInspectorActive } from "@/actions/inspectors";

export function ActiveToggle({ profileId, active }: { profileId: string; active: boolean }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    startTransition(async () => {
      const res = await toggleInspectorActive(profileId, !active);
      if (res.success) router.refresh();
      // Errors here are rare (RLS-denied writes would only happen if the
      // signed-in user's own role changed mid-session) -- not worth a
      // dedicated error UI for this button; a failed toggle simply leaves
      // the row unchanged on refresh.
    });
  }

  return (
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
  );
}
