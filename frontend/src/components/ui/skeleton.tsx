import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Phase 13: the standard shadcn/ui Skeleton primitive -- a plain pulsing
 * block used to build structured loading wireframes (see manager/loading.tsx,
 * manager/ppas/loading.tsx, manager/schedule/loading.tsx, and
 * manager/kpi-header.tsx's Suspense fallback) so the dashboard shows a
 * shape resembling the real layout while data is still being fetched,
 * instead of a blank page or a single spinner.
 */
function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("animate-pulse rounded-md bg-brand-navy/10", className)}
      {...props}
    />
  );
}

export { Skeleton };
