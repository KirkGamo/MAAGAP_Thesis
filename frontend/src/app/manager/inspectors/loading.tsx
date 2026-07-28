import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

const SKELETON_ROW_COUNT = 6;

/** Phase 15: loading.tsx for the Inspectors tab -- overrides ../loading.tsx,
 * which was only ever shaped for the Overview page (four tier cards + two
 * charts) and previously flashed a mismatched wireframe here. Shaped like
 * the real page: heading, invite form, then a single table card. */
export default function InspectorsLoading() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-7 w-32" />
        <Skeleton className="h-4 w-72" />
      </div>

      <Skeleton className="h-24 w-full" />

      <Card className="border-brand-navy/10 p-0">
        <CardHeader className="border-b border-brand-navy/10 px-5 py-4">
          <Skeleton className="h-5 w-32" />
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
