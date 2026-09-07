import { Card } from "@/components/tremor/card";
import { Skeleton } from "@/components/ui/skeleton";

const SKELETON_SLOT_COUNT = 6;

/** loading.tsx for the Inspectors tab -- overrides ../loading.tsx, which
 * is shaped for the Overview page. Mirrors the roster console's
 * single-viewport grid (see page.tsx): title + readiness chips, the
 * optimizer-slot grid, then the unrostered table, all pinned to the same
 * calc height so the wireframe doesn't jump. */
export default function InspectorsLoading() {
  return (
    <div className="flex flex-col gap-3 lg:h-[calc(100dvh-7.25rem)] lg:min-h-135 lg:overflow-hidden">
      <div className="flex shrink-0 flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-3 w-72" />
        </div>
        <Skeleton className="h-10 w-36" />
      </div>

      <div className="flex shrink-0 gap-1.5">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-6 w-32" />
        ))}
      </div>

      <Card className="flex flex-col p-4 lg:min-h-0 lg:flex-1">
        <Skeleton className="mb-2 h-4 w-32" />
        <div className="grid auto-rows-min grid-cols-2 gap-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: SKELETON_SLOT_COUNT }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      </Card>

      <Card className="flex shrink-0 flex-col p-4">
        <Skeleton className="mb-2 h-4 w-28" />
        <Skeleton className="h-16 w-full" />
      </Card>
    </div>
  );
}
