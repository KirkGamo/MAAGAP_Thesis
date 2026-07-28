"use client";

import dynamic from "next/dynamic";
import type { ScheduleMapPoint } from "./schedule-map";

// Leaflet touches `window` at import time, which breaks server rendering —
// load the actual map only in the browser. Same pattern as
// app/manager/map/map-loader.tsx.
const ScheduleMap = dynamic(() => import("./schedule-map").then((m) => m.ScheduleMap), {
  ssr: false,
  loading: () => (
    <div className="flex h-[460px] w-full items-center justify-center rounded-md bg-slate-100 text-sm text-slate-400">
      Loading map...
    </div>
  ),
});

export function ScheduleMapLoader({ points }: { points: ScheduleMapPoint[] }) {
  return <ScheduleMap points={points} />;
}
