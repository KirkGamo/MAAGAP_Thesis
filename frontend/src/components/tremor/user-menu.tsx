"use client";

import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

function initials(name: string | null): string {
  if (!name) return "M";
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[parts.length - 1]?.[0] ?? "")).toUpperCase() || "M";
}

/**
 * Phase 11, Task 1: the avatar + dropdown shown top-right in every attached
 * template screenshot. Deliberately minimal compared to the templates'
 * "Theme / Changelog / Documentation / Join Slack community" menu -- this
 * app has none of those (no dark mode is implemented anywhere in
 * globals.css's @theme block, no public changelog/docs site, no Slack
 * community), so those entries were left out rather than added as dead
 * links. What's real -- the signed-in Manager's name and a working sign-out
 * -- is what's here (sign-out logic matches app/inspector/sign-out-button.tsx's
 * existing pattern, just adapted for the Manager Portal's redirect target).
 */
export function UserMenu({
  fullName,
  email,
}: {
  fullName: string | null;
  email: string | null;
}) {
  const router = useRouter();

  return (
    <DropdownMenuPrimitive.Root>
      <DropdownMenuPrimitive.Trigger asChild>
        <button
          type="button"
          aria-label="Account menu"
          className={cn(
            "flex size-9 items-center justify-center rounded-full bg-brand-navy",
            "text-xs font-semibold text-white transition-opacity hover:opacity-90"
          )}
        >
          {initials(fullName)}
        </button>
      </DropdownMenuPrimitive.Trigger>
      <DropdownMenuPrimitive.Portal>
        <DropdownMenuPrimitive.Content
          align="end"
          sideOffset={8}
          className="z-50 w-56 rounded-lg border border-brand-navy/10 bg-white p-1 shadow-lg"
        >
          <div className="px-3 py-2">
            <p className="truncate text-sm font-medium text-brand-navy">
              {fullName ?? "Manager"}
            </p>
            {email && <p className="truncate text-xs text-slate-400">{email}</p>}
          </div>
          <DropdownMenuPrimitive.Separator className="my-1 h-px bg-brand-navy/10" />
          <DropdownMenuPrimitive.Item
            onSelect={async () => {
              const supabase = createClient();
              await supabase.auth.signOut();
              router.replace("/login");
              router.refresh();
            }}
            className={cn(
              "flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm text-brand-navy",
              "outline-none transition-colors data-[highlighted]:bg-brand-surface"
            )}
          >
            <LogOut className="size-4" />
            Sign out
          </DropdownMenuPrimitive.Item>
        </DropdownMenuPrimitive.Content>
      </DropdownMenuPrimitive.Portal>
    </DropdownMenuPrimitive.Root>
  );
}
