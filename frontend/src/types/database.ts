/**
 * Hand-written Supabase database types, matching `supabase/schema.sql`.
 *
 * In a real deployment these should be generated from the live schema via
 * the Supabase CLI (`supabase gen types typescript --local > src/types/database.ts`)
 * so they can never drift from the actual database. This hand-written
 * version exists so the scaffold type-checks before a live Supabase project
 * is connected — regenerate it as the first step after running
 * `supabase/schema.sql` against a real project.
 *
 * SHAPE NOTE (Phase 8.5 fix): every table needs a `Relationships` array,
 * and the `public` schema needs `Views`/`Functions`/`Enums`/
 * `CompositeTypes` keys (even if empty), because postgrest-js's
 * `GenericSchema`/`GenericTable` types require them structurally. An
 * earlier version of this file omitted them (a plausible-looking but
 * incomplete hand-write), which silently collapsed every `.from(...)`
 * query's inferred type to `never` once @supabase/supabase-js was
 * upgraded past ~2.5x — every column access in every Server
 * Component/Action started failing `tsc` with
 * "Property 'x' does not exist on type 'never'" despite the code itself
 * being correct. Match this exact shape (the same one the Supabase CLI's
 * `gen types` command produces) to avoid that class of bug recurring.
 */

export type UserRole = "manager" | "inspector";

export type RiskTier = "Low" | "Medium" | "High" | "Critical";

export type ProjectStatus =
  | "not_yet_implemented"
  | "on_going"
  | "completed"
  | "for_bidding";

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "13";
  };
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string; // references auth.users.id
          full_name: string | null;
          role: UserRole;
          active: boolean;
          inspector_slug: string | null;
          created_at: string;
        };
        Insert: {
          id: string;
          full_name?: string | null;
          role?: UserRole;
          active?: boolean;
          inspector_slug?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          full_name?: string | null;
          role?: UserRole;
          active?: boolean;
          inspector_slug?: string | null;
          created_at?: string;
        };
        Relationships: [];
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
          latitude: number | null; // geocoded from `location` -- see scripts/geocode_projects.py
          longitude: number | null;
        };
        Insert: Partial<Database["public"]["Tables"]["projects"]["Row"]> & {
          project_key: string;
          name_of_project: string;
          location: string;
        };
        Update: Partial<Database["public"]["Tables"]["projects"]["Row"]>;
        Relationships: [
          {
            foreignKeyName: "projects_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
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
        Relationships: [
          {
            foreignKeyName: "inspector_schedules_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "inspector_schedules_inspector_id_fkey";
            columns: ["inspector_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
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
        Relationships: [
          {
            foreignKeyName: "monitoring_reports_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "monitoring_reports_inspector_id_fkey";
            columns: ["inspector_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: {
      user_role: UserRole;
      project_status: ProjectStatus;
    };
    CompositeTypes: Record<string, never>;
  };
};
