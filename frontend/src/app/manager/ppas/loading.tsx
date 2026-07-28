import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

const SKELETON_ROW_COUNT = 8;

/** Phase 13: loading.tsx for the PPAs tab -- overrides ../loading.tsx.
 * Shaped like the real page (see page.tsx): heading + Import button,
 * filters row, then a table card with a header and a handful of row
 * placeholders plus a pagination-footer placeholder, so the wireframe
 * doesn't visibly jump once the real 50-row page of data arrives. */
export default function PpasLoading() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-7 w-96" />
          <Skeleton className="h-4 w-72" />
        </div>
        <Skeleton className="h-10 w-36" />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-3">
          <Skeleton className="h-10 w-64" />
          <Skeleton className="h-10 w-36" />
          <Skeleton className="h-10 w-36" />
        </div>
        <Skeleton className="h-9 w-32" />
      </div>

      <Card className="border-brand-navy/10 p-0">
        <CardHeader className="border-b border-brand-navy/10 px-5 py-4">
          <Skeleton className="h-5 w-24" />
        </CardHeader>
        <CardContent className="flex flex-col gap-3 p-5">
          {Array.from({ length: SKELETON_ROW_COUNT }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </CardContent>
        <div className="flex items-center justify-between border-t border-brand-navy/10 px-5 py-3">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-8 w-48" />
        </div>
      </Card>
    </div>
  );
}
