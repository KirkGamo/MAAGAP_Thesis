"use client";

import * as SheetPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Phase 19: shadcn/ui's "Sheet" pattern (a right-anchored slide-over built
 * on @radix-ui/react-dialog) -- introduced specifically so "Import
 * Projects" can open in-place over the PPAs page instead of navigating to
 * /manager/import, per a reference screenshot of an "Add New Transaction"
 * slide-out panel. Built as a small local wrapper (not a new dependency
 * beyond react-dialog itself) rather than pulling in the rest of shadcn/ui,
 * matching how dropdown-menu.tsx and the filter sidebar's slider already
 * wrap individual @radix-ui primitives directly in this codebase.
 *
 * Uses Tailwind v4's native `data-[state=...]` attribute variants for the
 * open/close slide + fade transition (no tailwindcss-animate plugin
 * installed in this project -- data-table.tsx's dropdown already proves
 * `data-[highlighted]:...` works the same way without one).
 */
const Sheet = SheetPrimitive.Root;
const SheetTrigger = SheetPrimitive.Trigger;
const SheetClose = SheetPrimitive.Close;

function SheetOverlay({ className, ...props }: React.ComponentProps<typeof SheetPrimitive.Overlay>) {
  return (
    <SheetPrimitive.Overlay
      className={cn(
        "fixed inset-0 z-50 bg-brand-navy/30 opacity-0 transition-opacity duration-300 ease-in-out data-[state=open]:opacity-100",
        className
      )}
      {...props}
    />
  );
}

function SheetContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Content>) {
  return (
    <SheetPrimitive.Portal>
      <SheetOverlay />
      <SheetPrimitive.Content
        className={cn(
          "fixed inset-y-0 right-0 z-50 flex h-full w-full translate-x-full flex-col border-l border-brand-navy/10 bg-white shadow-xl transition-transform duration-300 ease-in-out data-[state=open]:translate-x-0 sm:max-w-lg",
          className
        )}
        {...props}
      >
        {children}
        <SheetPrimitive.Close className="absolute right-4 top-4 rounded-md p-1 text-slate-400 transition-colors hover:bg-brand-surface hover:text-brand-navy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/40">
          <X className="size-4" aria-hidden="true" />
          <span className="sr-only">Close</span>
        </SheetPrimitive.Close>
      </SheetPrimitive.Content>
    </SheetPrimitive.Portal>
  );
}

function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("flex flex-col gap-1 border-b border-brand-navy/10 px-6 py-5 pr-12", className)}
      {...props}
    />
  );
}

function SheetTitle({ className, ...props }: React.ComponentProps<typeof SheetPrimitive.Title>) {
  return (
    <SheetPrimitive.Title
      className={cn("text-lg font-semibold text-brand-navy", className)}
      {...props}
    />
  );
}

function SheetDescription({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Description>) {
  return <SheetPrimitive.Description className={cn("text-sm text-slate-500", className)} {...props} />;
}

function SheetBody({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("flex-1 overflow-y-auto px-6 py-5", className)} {...props} />;
}

export {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetBody,
};
