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
 * now, so it mirrors that page's single-viewport grid exactly (see
 * page.tsx's layout comment): the KPI + tier-count top strip, then the
 * 2x2 chart grid with the municipality card spanning both rows.
 */
export default function ManagerLoading() {
  return (
    <div className="flex flex-col gap-3 lg:h-[calc(100dvh-7.25rem)] lg:min-h-135 lg:overflow-hidden">
      <div className="grid shrink-0 gap-3 lg:grid-cols-[1.2fr_1fr]">
        <Card className="p-4">
          <KpiHeaderSkeleton />
        </Card>
        <Card className="p-4">
          <div className="grid grid-cols-4 gap-2">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="flex flex-col gap-2 border-l-4 border-l-slate-200 pl-2">
                <Skeleton className="h-3 w-12" />
                <Skeleton className="h-7 w-10" />
              </div>
            ))}
          </div>
          <Skeleton className="mt-2 h-3 w-full" />
        </Card>
      </div>

      <div className="grid gap-3 lg:min-h-0 lg:flex-1 lg:grid-cols-2 lg:grid-rows-2">
        <Card className="flex flex-col p-4 lg:row-span-2 lg:min-h-0">
          <Skeleton className="h-4 w-44" />
          <Skeleton className="mt-3 h-6 w-32" />
          <Skeleton className="mt-3 min-h-80 flex-1" />
        </Card>
        <Card className="flex flex-col p-4 lg:min-h-0">
          <Skeleton className="h-4 w-48" />
          <Skeleton className="mt-3 min-h-60 flex-1" />
        </Card>
        <div className="grid gap-3 sm:grid-cols-2 lg:min-h-0">
          {[0, 1].map((i) => (
            <Card key={i} className="flex flex-col p-4 lg:min-h-0">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="mt-3 min-h-60 flex-1" />
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
