import { Card } from "@/components/tremor/card";
import { Skeleton } from "@/components/ui/skeleton";

/** Phase 15: loading.tsx for the Models tab -- overrides ../loading.tsx,
 * which was only ever shaped for the Overview page and previously flashed
 * a mismatched wireframe here. Shaped like the real page: heading, a
 * meta-learner metrics card, a confusion-matrix card, then two Level 0
 * model cards side by side. */
export default function ModelsLoading() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-7 w-24" />
        <Skeleton className="h-4 w-96" />
      </div>

      <Card>
        <Skeleton className="h-4 w-56" />
        <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-5">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      </Card>

      <Card>
        <Skeleton className="h-4 w-64" />
        <div className="mt-3 grid max-w-md grid-cols-2 gap-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Card>
          <Skeleton className="h-4 w-40" />
          <Skeleton className="mt-2 h-8 w-16" />
        </Card>
        <Card>
          <Skeleton className="h-4 w-40" />
          <Skeleton className="mt-2 h-8 w-16" />
        </Card>
      </div>
    </div>
  );
}
