import { NextRequest } from "next/server";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { applyPpaFilters, type PpaFilterParams } from "../filters";

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

/** The exact columns selected below. Declared rather than inferred: the
 * filter builder's return type widens to `any`, which would silently stop
 * checking the CSV mapping against the select list -- the one place where a
 * renamed column must not pass unnoticed. */
interface ExportRow {
  project_key: string | null;
  name_of_project: string | null;
  municipality: string | null;
  project_type: string | null;
  amount_php: number | null;
  status: string | null;
  date_last_monitored: string | null;
  risk_tier: string | null;
  risk_probability: number | null;
}

/**
 * Phase 16/17: CSV export for the PPAs tab, honoring the exact same
 * filters as the table/map views -- built as a Route Handler rather than a
 * Server Action so the "Export" control can be a plain `<a href>` download
 * link with the current query string, no client-side JS trigger needed.
 * Always exports every matching row, since "export the current page only"
 * is rarely what a Manager filtering down to a few hundred rows actually
 * wants. That intent was stated here from the start but not implemented:
 * PostgREST caps an unbounded select() at 1,000 rows and returns no error,
 * so an unfiltered export silently produced 1,000 of 2,393 projects --
 * HTTP 200, a well-formed CSV, and 58% of the portfolio missing with
 * nothing to indicate it. Both reads below are paged explicitly.
 *
 * Filter application delegates entirely to filters.ts's `applyPpaFilters`
 * -- the same function page.tsx uses -- so this can never drift out of
 * sync with what the Manager sees on screen.
 */
export async function GET(request: NextRequest) {
  await requireRole(["manager"]);
  const supabase = await createClient();
  const searchParams = request.nextUrl.searchParams;

  const params: PpaFilterParams = {
    q: searchParams.get("q") ?? undefined,
    risk_tier: searchParams.get("risk_tier") ?? undefined,
    status: searchParams.get("status") ?? undefined,
    project_type: searchParams.get("project_type") ?? undefined,
    municipality: searchParams.get("municipality") ?? undefined,
    revenue_min: searchParams.get("revenue_min") ?? undefined,
    revenue_max: searchParams.get("revenue_max") ?? undefined,
    risk_min: searchParams.get("risk_min") ?? undefined,
    risk_max: searchParams.get("risk_max") ?? undefined,
  };

  // Same live distinct-municipality validation page.tsx does, so a
  // municipality param here is trusted exactly as much as it is there.
  const PAGE_SIZE = 1000;
  const municipalityRows: { municipality: string | null }[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data } = await supabase
      .from("projects")
      .select("municipality")
      .not("municipality", "is", null)
      .range(offset, offset + PAGE_SIZE - 1);
    if (!data?.length) break;
    municipalityRows.push(...data);
    if (data.length < PAGE_SIZE) break;
  }
  const municipalities = Array.from(
    new Set(municipalityRows.map((r) => r.municipality).filter((m): m is string => Boolean(m)))
  );

  // Rebuilt per page: a PostgrestFilterBuilder is consumed when awaited, so
  // the same instance cannot be ranged twice. The order is applied inside the
  // loop too, so paging stays stable across requests.
  const buildPage = (offset: number) => {
    const q = supabase
      .from("projects")
      .select(
        "project_key, name_of_project, municipality, project_type, amount_php, status, date_last_monitored, risk_tier, risk_probability"
      )
      .order("risk_probability", { ascending: false, nullsFirst: false })
      .range(offset, offset + PAGE_SIZE - 1);
    return applyPpaFilters(q, params, municipalities);
  };

  const data: ExportRow[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data: page, error } = await buildPage(offset);
    if (error) {
      return new Response(`Export failed: ${error.message}`, { status: 500 });
    }
    if (!page?.length) break;
    data.push(...(page as ExportRow[]));
    if (page.length < PAGE_SIZE) break;
  }

  const header = [
    "Project Key",
    "Project Name",
    "Municipality",
    "Project Type",
    "Budget (PHP)",
    "Status",
    "Last Monitored",
    "Risk Tier",
    "P(RedFlag)",
  ];
  const rows = data.map((p) =>
    [
      csvField(p.project_key),
      csvField(p.name_of_project),
      csvField(p.municipality),
      csvField(p.project_type),
      csvField(p.amount_php),
      csvField(p.status),
      csvField(p.date_last_monitored),
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
