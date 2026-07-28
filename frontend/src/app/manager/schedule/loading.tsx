import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

const DAY_COUNT = 5;

/** Phase 13: loading.tsx for the Schedule tab -- overrides ../loading.tsx.
 * Shaped like the real page (see page.tsx + schedule-board.tsx): heading +
 * Deploy button, a map-sized placeholder, and a five-column board skeleton
 * matching the Kanban day layout so the wireframe doesn't jump once real
 * assignments render. */
export default function ScheduleLoading() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-7 w-32" />
          <Skeleton className="h-4 w-64" />
        </div>
        <Skeleton className="h-10 w-44" />
      </div>

      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-28" />
          <Skeleton className="mt-1 h-4 w-56" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-[460px] w-full" />
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {Array.from({ length: DAY_COUNT }).map((_, i) => (
          <Card key={i} className="flex flex-col p-0">
            <CardHeader className="border-b border-brand-navy/10 px-4 py-3">
              <Skeleton className="h-4 w-16" />
            </CardHeader>
            <CardContent className="flex flex-col gap-2 p-3">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
