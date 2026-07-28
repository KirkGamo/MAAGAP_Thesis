"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { ProjectStatus } from "@/types/database";

export interface ManualProjectInput {
  project_key: string;
  name_of_project: string;
  location: string;
  municipality?: string;
  amount_php?: number;
  status: ProjectStatus;
  date_released?: string;
}

/**
 * Manager-only: create a single project record via the manual-entry form
 * on /manager/import. Row Level Security (see supabase/schema.sql,
 * "projects: managers full access") independently enforces that only a
 * signed-in Manager can actually write to this table — this action does
 * not need its own role check, RLS is the enforcement layer.
 */
export async function createProject(input: ManualProjectInput) {
  const supabase = await createClient();

  const { error } = await supabase.from("projects").insert({
    project_key: input.project_key,
    name_of_project: input.name_of_project,
    location: input.location,
    municipality: input.municipality ?? null,
    amount_php: input.amount_php ?? null,
    status: input.status,
    date_released: input.date_released ?? null,
  });

  if (error) {
    return { success: false as const, error: error.message };
  }

  revalidatePath("/manager/ppas");
  return { success: true as const };
}

export interface CsvProjectRow {
  project_key: string;
  name_of_project: string;
  location: string;
  municipality?: string;
  amount_php?: string;
  status?: string;
  date_released?: string;
}

const STATUS_MAP: Record<string, ProjectStatus> = {
  completed: "completed",
  "completed/functional": "completed",
  "on-going": "on_going",
  ongoing: "on_going",
  "not yet implemented": "not_yet_implemented",
  "not implemented": "not_yet_implemented",
  "for bidding": "for_bidding",
};

function normalizeStatus(raw: string | undefined): ProjectStatus {
  if (!raw) return "not_yet_implemented";
  return STATUS_MAP[raw.trim().toLowerCase()] ?? "not_yet_implemented";
}

/**
 * Manager-only: bulk-import projects parsed client-side from an uploaded
 * CSV (see /manager/import's ImportCsvForm, which uses Papaparse in the
 * browser and passes the parsed rows here rather than uploading the raw
 * file — this keeps parsing logic on the client where errors are easy to
 * surface inline, and this action only has to deal with clean, typed rows).
 *
 * Uses `upsert` on `project_key` so re-importing an updated export of the
 * same workbook (the common PPDO workflow — a new monthly consolidated
 * sheet) updates existing rows instead of creating duplicates.
 */
export async function importProjectsCsv(rows: CsvProjectRow[]) {
  const supabase = await createClient();

  const records = rows
    .filter((r) => r.project_key && r.name_of_project)
    .map((r) => ({
      project_key: r.project_key.trim(),
      name_of_project: r.name_of_project.trim(),
      location: r.location?.trim() ?? "",
      municipality: r.municipality?.trim() || null,
      amount_php: r.amount_php ? Number(r.amount_php) : null,
      status: normalizeStatus(r.status),
      date_released: r.date_released || null,
    }));

  if (records.length === 0) {
    return { success: false as const, error: "No valid rows found in the uploaded file.", imported: 0 };
  }

  const { error } = await supabase
    .from("projects")
    .upsert(records, { onConflict: "project_key" });

  if (error) {
    return { success: false as const, error: error.message, imported: 0 };
  }

  revalidatePath("/manager/ppas");
  return { success: true as const, imported: records.length };
}
