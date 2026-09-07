import { Card } from "@/components/tremor/card";
import { Skeleton } from "@/components/ui/skeleton";

/** Loading skeleton for the Schedule tab -- overrides ../loading.tsx.
 * Mirrors the schedule workspace's single-viewport grid (see page.tsx):
 * top strip (title + scorecard chips + deploy button), day tabs, then the
 * map/agenda two-pane grid, all pinned to the same calc height so the
 * wireframe doesn't jump when the real workspace renders. */
export default function ScheduleLoading() {
  return (
    <div className="flex flex-col gap-3 lg:h-[calc(100dvh-7.25rem)] lg:min-h-135 lg:overflow-hidden">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-6 w-28" />
          <Skeleton className="h-3 w-56" />
        </div>
        <div className="flex gap-1.5">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-6 w-20" />
          ))}
        </div>
        <Skeleton className="h-10 w-44" />
      </div>

      <Skeleton className="h-9 w-96 shrink-0" />

      <div className="grid gap-3 lg:min-h-0 lg:flex-1 lg:grid-cols-[1.1fr_1fr]">
        <Card className="flex flex-col p-2 lg:min-h-0">
          <Skeleton className="min-h-80 flex-1" />
        </Card>
        <Card className="flex flex-col p-4 lg:min-h-0">
          <div className="mb-2 flex items-baseline justify-between">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-14" />
          </div>
          <div className="flex min-h-80 flex-1 flex-col gap-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-24 w-full" />
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
