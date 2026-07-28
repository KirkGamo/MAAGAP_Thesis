import { Card } from "@/components/tremor/card";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Phase 13: Next.js's loading.tsx convention -- this file automatically
 * wraps /manager/page.tsx (Overview) AND every deeper /manager/* segment
 * that doesn't provide its own more specific loading.tsx in a <Suspense>
 * boundary. manager/ppas/loading.tsx and manager/schedule/loading.tsx
 * override this with layout-specific skeletons; every other /manager/*
 * route (Inspectors, Models, Reports) falls back to this generic one
 * rather than going without a loading state at all.
 *
 * Shaped to roughly match the Overview page specifically (see page.tsx):
 * a heading, four risk-tier cards, then two chart-shaped cards.
 */
export default function ManagerLoading() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-4 w-72" />
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Card key={i}>
            <Skeleton className="h-4 w-16" />
            <Skeleton className="mt-2 h-8 w-12" />
          </Card>
        ))}
      </div>

      <Card>
        <Skeleton className="h-4 w-64" />
        <Skeleton className="mt-3 h-8 w-full" />
      </Card>

      <Card>
        <Skeleton className="h-4 w-80" />
        <Skeleton className="mt-4 h-64 w-full" />
      </Card>
    </div>
  );
}
