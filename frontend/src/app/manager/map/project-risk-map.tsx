"use client";

import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";
import Link from "next/link";
import {
  ILOILO_PROVINCE_CENTER,
  ILOILO_PROVINCE_DEFAULT_ZOOM,
  resolveMunicipalityCoordinates,
} from "@/lib/municipality-coordinates";
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

/** Simple deterministic string hash, used only to jitter pins that share a
 * municipality's exact town-center coordinate so they don't stack
 * perfectly on top of one another. Not cryptographic — just needs to be
 * stable per project_key. */
function hashToUnitInterval(key: string): number {
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash << 5) - hash + key.charCodeAt(i);
    hash |= 0;
  }
  return (Math.abs(hash) % 1000) / 1000;
}

function jitteredCoordinates(municipality: string | null, projectKey: string): [number, number] {
  const [lat, lng] = resolveMunicipalityCoordinates(municipality);
  const angle = hashToUnitInterval(projectKey) * 2 * Math.PI;
  const radiusDegrees = 0.01 + hashToUnitInterval(projectKey + "r") * 0.015;
  return [lat + Math.sin(angle) * radiusDegrees, lng + Math.cos(angle) * radiusDegrees];
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
        {plottable.map((project) => (
          <Marker
            key={project.id}
            position={jitteredCoordinates(project.municipality, project.project_key)}
            icon={riskDivIcon(project.risk_tier)}
          >
            <Popup>
              <div className="flex flex-col gap-1 text-sm">
                <Link href={`/manager/backlog/${project.id}`} className="font-medium hover:underline">
                  {project.name_of_project}
                </Link>
                <span className="text-slate-500">{project.municipality}</span>
                <span>
                  {project.risk_tier ?? "Unscored"}
                  {project.risk_probability != null && ` · P=${project.risk_probability.toFixed(2)}`}
                </span>
              </div>
            </Popup>
          </Marker>
        ))}
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
