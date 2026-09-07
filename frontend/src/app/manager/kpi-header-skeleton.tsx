import { Skeleton } from "@/components/ui/skeleton";

/** Suspense fallback for <KpiHeader> (see kpi-header.tsx) -- mirrors that
 * component's three-column shape so the layout doesn't jump/reflow once
 * the real numbers arrive. */
export function KpiHeaderSkeleton() {
  return (
    <div className="grid grid-cols-1 divide-y divide-brand-navy/10 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="flex items-start gap-2 py-3 first:pt-0 sm:px-4 sm:py-0 sm:first:pl-0 sm:last:pr-0"
        >
          <Skeleton className="mt-0.5 size-4 shrink-0 rounded-full" />
          <div className="flex flex-col gap-2">
            <Skeleton className="h-3 w-28" />
            <Skeleton className="h-7 w-16" />
          </div>
        </div>
      ))}
    </div>
  );
}
