import { Card } from "@/components/tremor/card";
import { Skeleton } from "@/components/ui/skeleton";

const SKELETON_ROW_COUNT = 7;

/** loading.tsx for the Reports tab -- overrides ../loading.tsx, which is
 * shaped for the Overview page. Mirrors the master-detail workspace (see
 * page.tsx): title + filters, then the list and detail panes pinned to
 * the same calc height. */
export default function ReportsLoading() {
  return (
    <div className="flex flex-col gap-3 lg:h-[calc(100dvh-7.25rem)] lg:min-h-135 lg:overflow-hidden">
      <div className="flex shrink-0 flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-6 w-28" />
          <Skeleton className="h-3 w-80" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-9 w-56" />
          <Skeleton className="h-9 w-36" />
        </div>
      </div>

      <div className="grid gap-3 lg:min-h-0 lg:flex-1 lg:grid-cols-[1fr_1.1fr]">
        <Card className="flex flex-col gap-2 p-3 lg:min-h-0">
          {Array.from({ length: SKELETON_ROW_COUNT }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full shrink-0" />
          ))}
        </Card>
        <Card className="flex flex-col gap-3 p-4 lg:min-h-0">
          <Skeleton className="h-5 w-64" />
          <Skeleton className="h-3 w-48" />
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-24 w-full" />
        </Card>
      </div>
    </div>
  );
}
