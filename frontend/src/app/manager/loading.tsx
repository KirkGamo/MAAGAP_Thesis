import { Card } from "@/components/tremor/card";
import { Skeleton } from "@/components/ui/skeleton";
import { KpiHeaderSkeleton } from "./kpi-header-skeleton";

/**
 * Phase 13: Next.js's loading.tsx convention -- this file automatically
 * wraps /manager/page.tsx (Overview) AND every deeper /manager/* segment
 * that doesn't provide its own more specific loading.tsx in a <Suspense>
 * boundary. manager/ppas/loading.tsx, manager/schedule/loading.tsx,
 * manager/inspectors/loading.tsx, manager/reports/loading.tsx, and
 * manager/models/loading.tsx all override this with layout-specific
 * skeletons (Phase 15) -- this generic one is effectively Overview-only
 * now, so it's shaped to match that page exactly (see page.tsx): the KPI
 * card (Phase 18 -- moved here from the shared layout), a heading, four
 * risk-tier cards, then two chart-shaped cards.
 */
export default function ManagerLoading() {
  return (
    <div className="flex flex-col gap-6">
      <Card className="p-6">
        <KpiHeaderSkeleton />
      </Card>

      <div className="flex flex-col gap-2">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-4 w-72" />
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Card key={i}>
            <Skeleton className="h-4 w-16" />
            <Skeleton className="mt-2 h-8 w-12" />
          </Card>
        ))}
      </div>

      <Card>
        <Skeleton className="h-4 w-64" />
        <Skeleton className="mt-3 h-8 w-full" />
      </Card>

      <Card>
        <Skeleton className="h-4 w-80" />
        <Skeleton className="mt-4 h-64 w-full" />
      </Card>
    </div>
  );
}
