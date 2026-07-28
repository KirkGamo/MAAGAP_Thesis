export interface MapProject {
  id: string;
  project_key: string;
  name_of_project: string;
  municipality: string | null;
  risk_tier: string | null;
  risk_probability: number | null;
  // Real, geocoded coordinates (see scripts/geocode_projects.py) -- when
  // present, the map places the pin here instead of at the jittered
  // municipality-center approximation (lib/pin-jitter.ts).
  latitude: number | null;
  longitude: number | null;
}
