export interface MapProject {
  id: string;
  project_key: string;
  name_of_project: string;
  municipality: string | null;
  risk_tier: string | null;
  risk_probability: number | null;
}
