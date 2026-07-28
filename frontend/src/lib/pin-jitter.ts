import { resolveMunicipalityCoordinates } from "@/lib/municipality-coordinates";

/** Simple deterministic string hash, used only to jitter pins that share a
 * municipality's exact town-center coordinate so they don't stack
 * perfectly on top of one another. Not cryptographic — just needs to be
 * stable per key.
 *
 * Extracted from app/manager/map/project-risk-map.tsx (Phase 8) into a
 * shared module in Phase 12 so the new Schedule map (schedule-map.tsx) can
 * place its pins with the exact same jitter behavior as the Risk Map,
 * rather than duplicating this logic a second time. */
export function hashToUnitInterval(key: string): number {
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash << 5) - hash + key.charCodeAt(i);
    hash |= 0;
  }
  return (Math.abs(hash) % 1000) / 1000;
}

/** Jitters a municipality's town-center coordinate by a small, stable
 * (per-key) offset so multiple pins in the same municipality fan out
 * instead of stacking exactly on top of one another. */
export function jitteredCoordinates(municipality: string | null, key: string): [number, number] {
  const [lat, lng] = resolveMunicipalityCoordinates(municipality);
  const angle = hashToUnitInterval(key) * 2 * Math.PI;
  const radiusDegrees = 0.01 + hashToUnitInterval(key + "r") * 0.015;
  return [lat + Math.sin(angle) * radiusDegrees, lng + Math.cos(angle) * radiusDegrees];
}
