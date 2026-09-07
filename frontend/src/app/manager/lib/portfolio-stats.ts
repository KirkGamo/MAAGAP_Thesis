import { PROJECT_TYPES, STATUSES } from "../ppas/filters";
import type { ProjectStatus, RiskTier } from "@/types/database";
import type { AvailableChartColorsKeys } from "@/components/tremor/chart-utils";

/**
 * Pure aggregation helpers behind the Overview page's "Portfolio
 * demographics" section (see DASHBOARD_UI_IMPROVEMENT_PLAN.md at the repo
 * root). Everything here takes already-fetched `projects` rows and returns
 * chart-shaped data -- no Supabase client, no async, so each function is
 * unit-testable and the one place the demographics' counting rules live.
 *
 * Scoping rule these helpers exist to enforce: demographics describe the
 * WHOLE seeded portfolio (all ~2,393 live rows), unlike the risk widgets
 * on the same page, which can only describe the scored subset (risk_tier
 * != null). Every row a chart excludes (no municipality, no release date,
 * no amount) is COUNTED and returned so the page can render it as a
 * visible footnote -- never silently dropped.
 */

export type ProjectType = (typeof PROJECT_TYPES)[number];

/** The columns the Overview page fetches for the whole portfolio -- one
 * shared shape so the demographics helpers and the page's risk widgets
 * read from the same rows. */
export interface PortfolioRow {
  municipality: string | null;
  status: ProjectStatus;
  project_type: ProjectType;
  amount_php: number | null;
  date_released: string | null;
  risk_tier: RiskTier | null;
}

// Demographic charts deliberately draw from blue/cyan/violet/gray only:
// amber/emerald/red/orange are this app's risk vocabulary (Tracker, Risk
// Map pins, badge.tsx, the risk-by-municipality BarChart), and a
// municipality count chart must not read as an alarm. Order matches
// PROJECT_TYPES: Infrastructure, Non-Infrastructure, Unclassified.
export const TYPE_CATEGORIES: string[] = [...PROJECT_TYPES];
export const TYPE_COLORS: AvailableChartColorsKeys[] = ["blue", "cyan", "gray"];

function emptyTypeCounts(): Record<ProjectType, number> {
  return { Infrastructure: 0, "Non-Infrastructure": 0, Unclassified: 0 };
}

// ---------------------------------------------------------------------
// PPAs per municipality
// ---------------------------------------------------------------------

// Chart datum shapes are type aliases, not interfaces, on purpose: the
// client chart wrappers accept `Record<string, string | number>[]` (the
// vendored BarChart's own data shape), and TypeScript only grants the
// implicit index signature that assignment needs to object-literal type
// aliases -- an interface here fails to typecheck at every call site.
export type MunicipalityTypeDatum = {
  municipality: string;
  Infrastructure: number;
  "Non-Infrastructure": number;
  Unclassified: number;
};

export interface MunicipalityTypeResult {
  /** One entry per distinct municipality, sorted by total PPAs descending. */
  data: MunicipalityTypeDatum[];
  /** Rows with no resolved municipality -- excluded from the bars (there is
   * no meaningful bar to plot them under), surfaced as a footnote count. */
  excludedNoMunicipality: number;
}

export function countByMunicipalityAndType(rows: PortfolioRow[]): MunicipalityTypeResult {
  const byMunicipality = new Map<string, Record<ProjectType, number>>();
  let excludedNoMunicipality = 0;

  for (const row of rows) {
    if (!row.municipality) {
      excludedNoMunicipality += 1;
      continue;
    }
    const bucket = byMunicipality.get(row.municipality) ?? emptyTypeCounts();
    bucket[row.project_type] += 1;
    byMunicipality.set(row.municipality, bucket);
  }

  const data = Array.from(byMunicipality.entries())
    .map(([municipality, counts]) => ({ municipality, ...counts }))
    .sort(
      (a, b) =>
        b.Infrastructure + b["Non-Infrastructure"] + b.Unclassified -
        (a.Infrastructure + a["Non-Infrastructure"] + a.Unclassified)
    );

  return { data, excludedNoMunicipality };
}

// ---------------------------------------------------------------------
// PPAs per year (year of fund release)
// ---------------------------------------------------------------------

export const UNDATED_YEAR_LABEL = "No release date";

/** Above this share of undated rows, hiding them behind a footnote would
 * misrepresent the portfolio's shape, so they get their own bucket at the
 * end of the year axis instead (see plan section 4.2). */
export const UNDATED_BUCKET_THRESHOLD = 0.15;

export type YearTypeDatum = {
  year: string;
  Infrastructure: number;
  "Non-Infrastructure": number;
  Unclassified: number;
};

export interface YearTypeResult {
  /** One entry per year ascending; if `includesUndatedBucket`, the last
   * entry is the UNDATED_YEAR_LABEL bucket. */
  data: YearTypeDatum[];
  undatedCount: number;
  includesUndatedBucket: boolean;
}

export function countByYearAndType(rows: PortfolioRow[]): YearTypeResult {
  const byYear = new Map<string, Record<ProjectType, number>>();
  const undated = emptyTypeCounts();
  let undatedCount = 0;

  for (const row of rows) {
    // date_released is an ISO `date` string from PostgREST (YYYY-MM-DD),
    // so the year is a plain prefix -- no Date parsing / timezone risk.
    const year = row.date_released?.slice(0, 4) ?? null;
    if (!year) {
      undated[row.project_type] += 1;
      undatedCount += 1;
      continue;
    }
    const bucket = byYear.get(year) ?? emptyTypeCounts();
    bucket[row.project_type] += 1;
    byYear.set(year, bucket);
  }

  const data: YearTypeDatum[] = Array.from(byYear.entries())
    .map(([year, counts]) => ({ year, ...counts }))
    .sort((a, b) => a.year.localeCompare(b.year));

  const includesUndatedBucket =
    rows.length > 0 && undatedCount / rows.length > UNDATED_BUCKET_THRESHOLD;
  if (includesUndatedBucket) {
    data.push({ year: UNDATED_YEAR_LABEL, ...undated });
  }

  return { data, undatedCount, includesUndatedBucket };
}

// ---------------------------------------------------------------------
// PPAs by status
// ---------------------------------------------------------------------

export const STATUS_COUNT_CATEGORY = "PPAs";

export type StatusDatum = {
  status: string;
  [STATUS_COUNT_CATEGORY]: number;
};

/** One entry per status in STATUSES' canonical lifecycle order (same
 * labels as the PPAs tab's filter sidebar and table badges), zero-count
 * statuses included -- an empty bar is information here, not noise. */
export function countByStatus(rows: PortfolioRow[]): StatusDatum[] {
  const counts = new Map<ProjectStatus, number>();
  for (const row of rows) {
    counts.set(row.status, (counts.get(row.status) ?? 0) + 1);
  }
  return STATUSES.map(({ value, label }) => ({
    status: label,
    [STATUS_COUNT_CATEGORY]: counts.get(value) ?? 0,
  }));
}

// ---------------------------------------------------------------------
// PPAs by project type
// ---------------------------------------------------------------------

export interface TypeCountsResult {
  counts: Record<ProjectType, number>;
  total: number;
  /** Single-row dataset for a 100%-stacked ("percent") bar. */
  percentData: [{ split: string } & Record<ProjectType, number>];
}

export function countByType(rows: PortfolioRow[]): TypeCountsResult {
  const counts = emptyTypeCounts();
  for (const row of rows) {
    counts[row.project_type] += 1;
  }
  return {
    counts,
    total: rows.length,
    percentData: [{ split: "All PPAs", ...counts }],
  };
}

// ---------------------------------------------------------------------
// Budget (amount_php) per municipality
// ---------------------------------------------------------------------

export const BUDGET_CATEGORY = "Total amount (₱)";

export type BudgetDatum = {
  municipality: string;
  [BUDGET_CATEGORY]: number;
};

export interface BudgetResult {
  /** Top `topN` municipalities by summed amount_php, descending. */
  data: BudgetDatum[];
  /** Rows with no recorded amount (they contribute nothing to any bar). */
  excludedNoAmount: number;
  /** Rows with an amount but no resolved municipality -- money that exists
   * in the portfolio but can't be attributed to a bar. */
  excludedNoMunicipality: number;
}

export function budgetByMunicipality(rows: PortfolioRow[], topN = 10): BudgetResult {
  const totals = new Map<string, number>();
  let excludedNoAmount = 0;
  let excludedNoMunicipality = 0;

  for (const row of rows) {
    if (row.amount_php == null) {
      excludedNoAmount += 1;
      continue;
    }
    if (!row.municipality) {
      excludedNoMunicipality += 1;
      continue;
    }
    // PostgREST serializes `numeric` as a JS number here (matching
    // types/database.ts's `amount_php: number | null`), but coerce
    // defensively -- a string that slipped through would otherwise
    // concatenate instead of add.
    totals.set(row.municipality, (totals.get(row.municipality) ?? 0) + Number(row.amount_php));
  }

  const data = Array.from(totals.entries())
    .map(([municipality, total]) => ({ municipality, [BUDGET_CATEGORY]: total }) as BudgetDatum)
    .sort((a, b) => b[BUDGET_CATEGORY] - a[BUDGET_CATEGORY])
    .slice(0, topN);

  return { data, excludedNoAmount, excludedNoMunicipality };
}
