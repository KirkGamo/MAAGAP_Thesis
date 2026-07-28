import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

const SKELETON_ROW_COUNT = 15;

/** Phase 17: loading.tsx for the PPAs tab -- overrides ../loading.tsx.
 * Shaped like the real page (see page.tsx): heading + view toggle + Import
 * button in one row, then a left filter-sidebar placeholder (now taller --
 * two range-slider sections plus four checkbox facet sections) alongside a
 * table card whose toolbar placeholder covers the search input, row
 * count, Toggle Columns button, and Export button, and a row area capped
 * to the same ~560px scroll height the real table uses, so the wireframe
 * doesn't visibly jump once the real controls/rows arrive. */
export default function PpasLoading() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-7 w-96" />
          <Skeleton className="h-4 w-72" />
        </div>
        <div className="flex items-center gap-3">
          <Skeleton className="h-10 w-32" />
          <Skeleton className="h-10 w-36" />
        </div>
      </div>

      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        <Skeleton className="h-[640px] w-full rounded-xl lg:w-64 lg:shrink-0" />

        <div className="min-w-0 flex-1">
          <Card className="border-brand-navy/10 p-0">
            <div className="flex items-center justify-between gap-3 border-b border-brand-navy/10 px-5 py-3">
              <Skeleton className="h-9 w-full max-w-sm" />
              <div className="flex shrink-0 items-center gap-3">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-9 w-24" />
                <Skeleton className="h-9 w-24" />
              </div>
            </div>
            <CardContent className="flex max-h-[560px] flex-col gap-3 overflow-hidden p-5">
              {Array.from({ length: SKELETON_ROW_COUNT }).map((_, i) => (
                <Skeleton key={i} className="h-8 w-full" />
              ))}
            </CardContent>
            <div className="flex items-center justify-between border-t border-brand-navy/10 px-5 py-3">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-8 w-64" />
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
