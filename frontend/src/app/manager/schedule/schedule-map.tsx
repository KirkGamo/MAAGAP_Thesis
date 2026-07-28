"use client";

import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";
import {
  ILOILO_PROVINCE_CENTER,
  ILOILO_PROVINCE_DEFAULT_ZOOM,
} from "@/lib/municipality-coordinates";
import { resolveProjectCoordinates } from "@/lib/pin-jitter";

export interface ScheduleMapPoint {
  id: string;
  inspectorName: string;
  projectName: string;
  municipality: string | null;
  // Real, geocoded coordinates (see scripts/geocode_projects.py) -- when
  // present, placed here instead of the jittered municipality-center
  // approximation. See lib/pin-jitter.ts's resolveProjectCoordinates().
  latitude: number | null;
  longitude: number | null;
  day: string;
  /** Hex color assigned per-inspector (see page.tsx's INSPECTOR_COLORS
   * palette) — this map answers "which inspector is going where", so pins
   * are colored by inspector identity rather than by risk tier (the Risk
   * Map's convention, a different question entirely). */
  color: string;
}

function inspectorDivIcon(color: string) {
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

/**
 * Phase 12: the map half of the Schedule tab's "map + inspector itinerary"
 * combo (the user's chosen approach over a node-link graph or a
 * timeline-only view — see the architecture discussion before this
 * phase). Deliberately NOT wrapped in MarkerClusterGroup like the Risk
 * Map: a single week's inspector_schedules row count is a small fraction
 * of the up-to-1,000-project population the Risk Map handles, so
 * clustering would just hide the very routing detail this view exists to
 * show.
 */
export function ScheduleMap({ points }: { points: ScheduleMapPoint[] }) {
  return (
    <MapContainer
      center={ILOILO_PROVINCE_CENTER}
      zoom={ILOILO_PROVINCE_DEFAULT_ZOOM}
      scrollWheelZoom
      style={{ height: "460px", width: "100%", borderRadius: "0.5rem" }}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {points.map((point) => (
        <Marker
          key={point.id}
          position={resolveProjectCoordinates(point, point.municipality, point.id)}
          icon={inspectorDivIcon(point.color)}
        >
          <Popup>
            <div className="flex flex-col gap-1 text-sm">
              <span className="font-medium">{point.inspectorName}</span>
              <span className="text-slate-600">{point.projectName}</span>
              <span className="text-slate-500">
                {point.municipality ?? "Unmapped"} · {point.day}
              </span>
              {point.latitude == null && (
                <span className="text-xs italic text-slate-400">
                  Approximate location — not yet geocoded
                </span>
              )}
            </div>
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}
