"use client";

import "leaflet/dist/leaflet.css";
// react-leaflet-cluster v4.1.3+ requires these CSS imports manually
// (see its README's "Breaking Changes in v3.0.0") rather than bundling
// them automatically, to avoid Next.js build issues.
import "react-leaflet-cluster/dist/assets/MarkerCluster.css";
import "react-leaflet-cluster/dist/assets/MarkerCluster.Default.css";
import L from "leaflet";
import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";
import MarkerClusterGroup from "react-leaflet-cluster";
import Link from "next/link";
import {
  ILOILO_PROVINCE_CENTER,
  ILOILO_PROVINCE_DEFAULT_ZOOM,
} from "@/lib/municipality-coordinates";
import { resolveProjectCoordinates } from "@/lib/pin-jitter";
import type { MapProject } from "./types";

const RISK_COLORS: Record<string, string> = {
  Low: "#10b981", // emerald-500 (green)
  Medium: "#f59e0b", // amber-500 (yellow)
  High: "#f97316", // orange-500
  Critical: "#dc2626", // red-600
};
const UNSCORED_COLOR = "#94a3b8"; // slate-400

function riskColor(tier: string | null): string {
  return tier ? RISK_COLORS[tier] ?? UNSCORED_COLOR : UNSCORED_COLOR;
}

function riskDivIcon(tier: string | null) {
  const color = riskColor(tier);
  return L.divIcon({
    className: "",
    html: `<span style="
      display:block;
      width:16px;height:16px;
      background:${color};
      border:2px solid white;
      border-radius:9999px;
      box-shadow:0 0 0 1px rgba(0,0,0,0.15);
    "></span>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
    popupAnchor: [0, -8],
  });
}

export function ProjectRiskMap({ projects }: { projects: MapProject[] }) {
  const plottable = projects.filter((p) => p.municipality);

  return (
    <div className="flex flex-col gap-3">
      <MapContainer
        center={ILOILO_PROVINCE_CENTER}
        zoom={ILOILO_PROVINCE_DEFAULT_ZOOM}
        scrollWheelZoom
        style={{ height: "520px", width: "100%", borderRadius: "0.5rem" }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {/* Phase 11, Task 4: cluster the pins so a ~1,000-project Western
            Visayas view stays legible/performant at province-wide zoom
            levels instead of rendering (and re-painting on every pan/zoom)
            up to 1,000 individual DOM markers at once. chunkedLoading
            defers clustering work across animation frames so it doesn't
            block the main thread on the initial render of a large project
            set. */}
        <MarkerClusterGroup chunkedLoading>
          {plottable.map((project) => (
            <Marker
              key={project.id}
              position={resolveProjectCoordinates(project, project.municipality, project.project_key)}
              icon={riskDivIcon(project.risk_tier)}
            >
              <Popup>
                <div className="flex flex-col gap-1 text-sm">
                  <Link href={`/manager/ppas/${project.id}`} className="font-medium hover:underline">
                    {project.name_of_project}
                  </Link>
                  <span className="text-slate-500">{project.municipality}</span>
                  <span>
                    {project.risk_tier ?? "Unscored"}
                    {project.risk_probability != null && ` · P=${project.risk_probability.toFixed(2)}`}
                  </span>
                  {project.latitude == null && (
                    <span className="text-xs italic text-slate-400">
                      Approximate location — not yet geocoded
                    </span>
                  )}
                </div>
              </Popup>
            </Marker>
          ))}
        </MarkerClusterGroup>
      </MapContainer>

      <div className="flex flex-wrap items-center gap-4 text-xs text-slate-500">
        {(["Low", "Medium", "High", "Critical"] as const).map((tier) => (
          <span key={tier} className="flex items-center gap-1.5">
            <span
              className="inline-block size-3 rounded-full border border-white"
              style={{ background: RISK_COLORS[tier] }}
            />
            {tier}
          </span>
        ))}
        <span className="flex items-center gap-1.5">
          <span className="inline-block size-3 rounded-full border border-white" style={{ background: UNSCORED_COLOR }} />
          Unscored
        </span>
      </div>
    </div>
  );
}
