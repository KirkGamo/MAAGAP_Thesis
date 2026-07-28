/**
 * Phase 17: shared PPAs filter constants + query-building logic, used by
 * both page.tsx (table/map views) and export/route.ts (CSV export) so the
 * two can never drift out of sync with each other. Unlike the client-side
 * `buildHref` duplication elsewhere in this tab (unavoidable -- Server ->
 * Client Component props can't carry functions), both callers here run
 * server-side, so there's no reason for this filtering logic to exist
 * twice.
 *
 * Facets (risk tier, status, project type, municipality) are multi-select,
 * encoded as a comma-separated list in a single URL param (e.g.
 * `risk_tier=Critical,High`) rather than repeated params or a JSON blob --
 * simplest thing that round-trips cleanly through `URLSearchParams`.
 * Numeric ranges (budget, risk probability) are two params each
 * (`..._min`/`..._max`); risk_probability is stored 0..1 in the database
 * but shown/filtered as a 0-100 percentage in the UI, so this is the one
 * place that /100 conversion happens.
 */

export const RISK_TIERS = ["Critical", "High", "Medium", "Low"] as const;
export const STATUSES = [
  { value: "not_yet_implemented", label: "Not Yet Implemented" },
  { value: "for_bidding", label: "For Bidding" },
  { value: "on_going", label: "On-going" },
  { value: "completed", label: "Completed" },
] as const;
export const PROJECT_TYPES = ["Infrastructure", "Non-Infrastructure", "Unclassified"] as const;

export interface PpaFilterParams {
  q?: string;
  risk_tier?: string;
  status?: string;
  project_type?: string;
  municipality?: string;
  revenue_min?: string;
  revenue_max?: string;
  risk_min?: string;
  risk_max?: string;
}

/** Every URL param a PPAs filter control can set -- used by the sidebar's
 * Reset button and the active-filters bar to build a "no filters applied"
 * URL and to detect whether any filter is currently active, without
 * either component needing its own hardcoded copy of this list. `view`
 * and `page` are deliberately excluded: view is a display mode, not a
 * filter, and page is a consequence of the other params, not a filter
 * itself. */
export const PPA_FILTER_PARAM_KEYS = [
  "q",
  "risk_tier",
  "status",
  "project_type",
  "municipality",
  "revenue_min",
  "revenue_max",
  "risk_min",
  "risk_max",
] as const;

export function parseCsvParam(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Applies every PPAs filter to a Supabase `projects` query builder.
 * Typed loosely (`any` in/out) rather than fighting PostgrestFilterBuilder's
 * generic signature, which narrows on every chained `.eq()`/`.in()` call in
 * a way that's impractical to express for a helper meant to take an
 * already-partially-built query -- same tradeoff bar-chart.tsx's
 * `valueFormatter` prop already makes elsewhere in this codebase.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function applyPpaFilters(query: any, params: PpaFilterParams, municipalities: string[]): any {
  let q = query;

  if (params.q) {
    q = q.ilike("name_of_project", `%${params.q}%`);
  }

  const riskTiers = parseCsvParam(params.risk_tier).filter((t) =>
    (RISK_TIERS as readonly string[]).includes(t)
  );
  if (riskTiers.length > 0) q = q.in("risk_tier", riskTiers);

  const statuses = parseCsvParam(params.status).filter((s) => STATUSES.some((x) => x.value === s));
  if (statuses.length > 0) q = q.in("status", statuses);

  const projectTypes = parseCsvParam(params.project_type).filter((t) =>
    (PROJECT_TYPES as readonly string[]).includes(t)
  );
  if (projectTypes.length > 0) q = q.in("project_type", projectTypes);

  const selectedMunicipalities = parseCsvParam(params.municipality).filter((m) =>
    municipalities.includes(m)
  );
  if (selectedMunicipalities.length > 0) q = q.in("municipality", selectedMunicipalities);

  if (params.revenue_min) q = q.gte("amount_php", Number(params.revenue_min));
  if (params.revenue_max) q = q.lte("amount_php", Number(params.revenue_max));
  if (params.risk_min) q = q.gte("risk_probability", Number(params.risk_min) / 100);
  if (params.risk_max) q = q.lte("risk_probability", Number(params.risk_max) / 100);

  return q;
}
