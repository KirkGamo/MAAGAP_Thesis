/**
 * Hand-written Supabase database types, matching `supabase/schema.sql`.
 *
 * In a real deployment these should be generated from the live schema via
 * the Supabase CLI (`supabase gen types typescript --local > src/types/database.ts`)
 * so they can never drift from the actual database. This hand-written
 * version exists so the scaffold type-checks before a live Supabase project
 * is connected — regenerate it as the first step after running
 * `supabase/schema.sql` against a real project.
 */

export type UserRole = "manager" | "inspector";

export type RiskTier = "Low" | "Medium" | "High" | "Critical";

export type ProjectStatus =
  | "not_yet_implemented"
  | "on_going"
  | "completed"
  | "for_bidding";

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string; // references auth.users.id
          full_name: string | null;
          role: UserRole;
          created_at: string;
        };
        Insert: {
          id: string;
          full_name?: string | null;
          role?: UserRole;
          created_at?: string;
        };
        Update: {
          id?: string;
          full_name?: string | null;
          role?: UserRole;
          created_at?: string;
        };
      };
      projects: {
        Row: {
          id: string;
          project_key: string; // matches ml-service's project_key (e.g. PRJ_1234)
          name_of_project: string;
          location: string;
          municipality: string | null;
          amount_php: number | null;
          status: ProjectStatus;
          date_released: string | null;
          date_of_completion: string | null;
          project_type: "Infrastructure" | "Non-Infrastructure" | "Unclassified";
          risk_tier: RiskTier | null;
          risk_probability: number | null;
          created_by: string | null; // profiles.id of the Manager who imported it
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["projects"]["Row"]> & {
          project_key: string;
          name_of_project: string;
          location: string;
        };
        Update: Partial<Database["public"]["Tables"]["projects"]["Row"]>;
      };
      inspector_schedules: {
        Row: {
          id: string;
          project_id: string; // references projects.id
          inspector_id: string; // references profiles.id
          scheduled_day: string; // e.g. "Mon", "Tue", ...
          week_of: string; // date (Monday) identifying the scheduling week
          cluster: string | null;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["inspector_schedules"]["Row"]> & {
          project_id: string;
          inspector_id: string;
          scheduled_day: string;
          week_of: string;
        };
        Update: Partial<Database["public"]["Tables"]["inspector_schedules"]["Row"]>;
      };
      monitoring_reports: {
        Row: {
          id: string;
          project_id: string;
          inspector_id: string;
          visited_at: string;
          status_observed: ProjectStatus;
          percent_complete: number | null;
          remarks: string | null;
          photo_urls: string[] | null;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["monitoring_reports"]["Row"]> & {
          project_id: string;
          inspector_id: string;
          status_observed: ProjectStatus;
        };
        Update: Partial<Database["public"]["Tables"]["monitoring_reports"]["Row"]>;
      };
    };
  };
}
