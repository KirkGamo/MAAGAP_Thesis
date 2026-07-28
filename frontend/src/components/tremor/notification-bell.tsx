"use client";

import * as PopoverPrimitive from "@radix-ui/react-popover";
import { Bell } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Phase 11, Task 1: the notification bell shown in every attached template
 * screenshot's top-right corner.
 *
 * DELIBERATE SCOPE LIMIT: MAAGAP has no notifications table/backend (no
 * schema for "who should be told what, when" exists anywhere in
 * supabase/schema.sql). Rather than fabricate demo notification content to
 * visually match the screenshots (which would misrepresent a real feature
 * as existing), this renders the real affordance -- a bell that opens a
 * panel -- with an honest empty state, following this project's established
 * convention of flagging out-of-scope work explicitly instead of faking it
 * (see e.g. submit-report.ts's "WHAT IS DELIBERATELY NOT HERE" docstring
 * section). Wiring this to a real notifications table/subscription is a
 * clearly-scoped follow-up, not a silent gap.
 */
export function NotificationBell() {
  return (
    <PopoverPrimitive.Root>
      <PopoverPrimitive.Trigger asChild>
        <button
          type="button"
          aria-label="Notifications"
          className={cn(
            "flex size-9 items-center justify-center rounded-full border border-brand-navy/10",
            "text-brand-navy/70 transition-colors hover:bg-brand-surface hover:text-brand-navy"
          )}
        >
          <Bell className="size-4" />
        </button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="end"
          sideOffset={8}
          className="z-50 w-72 rounded-lg border border-brand-navy/10 bg-white p-4 shadow-lg"
        >
          <p className="text-sm font-semibold text-brand-navy">Notifications</p>
          <p className="mt-2 text-sm text-slate-400">
            No notifications system is wired up yet -- this panel is a
            placeholder for a future alerts feature (e.g. new Critical-tier
            projects, SLA-style deadlines on inspector schedules).
          </p>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
