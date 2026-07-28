import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

const SKELETON_ROW_COUNT = 8;

/** Phase 15: loading.tsx for the Reports tab -- overrides ../loading.tsx,
 * which was only ever shaped for the Overview page and previously flashed
 * a mismatched wireframe here. Shaped like the real page: heading, filter
 * row, then a single table card. */
export default function ReportsLoading() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-7 w-28" />
        <Skeleton className="h-4 w-96" />
      </div>

      <div className="flex gap-3">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-10 w-36" />
      </div>

      <Card className="border-brand-navy/10 p-0">
        <CardHeader className="border-b border-brand-navy/10 px-5 py-4">
          <Skeleton className="h-5 w-28" />
        </CardHeader>
        <CardContent className="flex flex-col gap-3 p-5">
          {Array.from({ length: SKELETON_ROW_COUNT }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
