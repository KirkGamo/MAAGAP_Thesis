"use client";

import dynamic from "next/dynamic";
import type { MapProject } from "./types";

// Leaflet touches `window` at import time, which breaks server rendering —
// load the actual map only in the browser. This wrapper is the standard
// react-leaflet + Next.js App Router pattern for that.
const ProjectRiskMap = dynamic(() => import("./project-risk-map").then((m) => m.ProjectRiskMap), {
  ssr: false,
  loading: () => (
    <div className="flex h-full min-h-[300px] w-full items-center justify-center rounded-md bg-slate-100 text-sm text-slate-400">
      Loading map...
    </div>
  ),
});

export function MapLoader({ projects }: { projects: MapProject[] }) {
  return <ProjectRiskMap projects={projects} />;
}
