import { Skeleton } from "@/components/ui/skeleton";

/** Suspense fallback for <KpiHeader> (see kpi-header.tsx) -- mirrors that
 * component's three-column shape so the layout doesn't jump/reflow once
 * the real numbers arrive. */
export function KpiHeaderSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex flex-col gap-2">
          <Skeleton className="h-3.5 w-32" />
          <Skeleton className="h-8 w-20" />
        </div>
      ))}
    </div>
  );
}
