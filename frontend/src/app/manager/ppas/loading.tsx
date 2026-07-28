import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

const SKELETON_ROW_COUNT = 8;

/** Phase 16: loading.tsx for the PPAs tab -- overrides ../loading.tsx.
 * Shaped like the real page (see page.tsx): heading + Import button, then
 * a left filter-sidebar placeholder alongside a table card with a
 * search-bar header, row placeholders, and a pagination-footer
 * placeholder, so the wireframe doesn't visibly jump once the real
 * sidebar/table/pagination arrive. */
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

      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        <Skeleton className="h-56 w-full rounded-xl lg:w-56 lg:shrink-0" />

        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <div className="flex justify-end">
            <Skeleton className="h-9 w-32" />
          </div>

          <Card className="border-brand-navy/10 p-0">
            <div className="flex items-center justify-between gap-3 border-b border-brand-navy/10 px-5 py-3">
              <Skeleton className="h-9 w-full max-w-sm" />
              <Skeleton className="h-4 w-24 shrink-0" />
            </div>
            <CardContent className="flex flex-col gap-3 p-5">
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
