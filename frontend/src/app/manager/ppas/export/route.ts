import { NextRequest } from "next/server";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { ProjectStatus, RiskTier } from "@/types/database";

const RISK_TIERS = ["Critical", "High", "Medium", "Low"] as const;
const STATUSES = ["not_yet_implemented", "for_bidding", "on_going", "completed"] as const;
const PROJECT_TYPES = ["Infrastructure", "Non-Infrastructure", "Unclassified"] as const;

/** Quotes a CSV field per RFC 4180: wrap in double quotes and escape any
 * embedded double quotes, but only when the value actually needs it (a
 * bare number/short word doesn't need quoting) -- keeps the common case
 * readable while still being correct for names containing commas. */
function csvField(value: string | number | null | undefined): string {
  const s = value == null ? "" : String(value);
  if (/[",\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/**
 * Phase 16: CSV export for the PPAs tab, honoring the exact same filters
 * (q, risk_tier, status, municipality, project_type) as the table/map
 * views -- built as a Route Handler rather than a Server Action so the
 * "Export" control can be a plain `<a href>` download link with the
 * current query string, no client-side JS trigger needed. Always exports
 * every matching row (no pagination), since "export the current page
 * only" is rarely what a Manager filtering down to a few hundred rows
 * actually wants.
 */
export async function GET(request: NextRequest) {
  await requireRole(["manager"]);
  const supabase = await createClient();
  const params = request.nextUrl.searchParams;

  let query = supabase
    .from("projects")
    .select("project_key, name_of_project, municipality, project_type, status, risk_tier, risk_probability")
    .order("risk_probability", { ascending: false, nullsFirst: false });

  const q = params.get("q");
  if (q) query = query.ilike("name_of_project", `%${q}%`);

  const riskTier = params.get("risk_tier");
  if (riskTier && (RISK_TIERS as readonly string[]).includes(riskTier)) {
    query = query.eq("risk_tier", riskTier as RiskTier);
  }

  const status = params.get("status");
  if (status && (STATUSES as readonly string[]).includes(status)) {
    query = query.eq("status", status as ProjectStatus);
  }

  const municipality = params.get("municipality");
  if (municipality) query = query.eq("municipality", municipality);

  const projectType = params.get("project_type");
  if (projectType && (PROJECT_TYPES as readonly string[]).includes(projectType)) {
    query = query.eq(
      "project_type",
      projectType as "Infrastructure" | "Non-Infrastructure" | "Unclassified"
    );
  }

  const { data, error } = await query;
  if (error) {
    return new Response(`Export failed: ${error.message}`, { status: 500 });
  }

  const header = [
    "Project Key",
    "Project Name",
    "Municipality",
    "Project Type",
    "Status",
    "Risk Tier",
    "P(RedFlag)",
  ];
  const rows = (data ?? []).map((p) =>
    [
      csvField(p.project_key),
      csvField(p.name_of_project),
      csvField(p.municipality),
      csvField(p.project_type),
      csvField(p.status),
      csvField(p.risk_tier),
      csvField(p.risk_probability != null ? `${(p.risk_probability * 100).toFixed(1)}%` : ""),
    ].join(",")
  );
  const csv = [header.join(","), ...rows].join("\n");

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="ppas-export-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
