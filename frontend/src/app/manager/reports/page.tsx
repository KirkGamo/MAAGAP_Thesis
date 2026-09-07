import { createClient } from "@/lib/supabase/server";
import { isMissingColumnError } from "@/lib/postgrest-errors";
import { Card } from "@/components/tremor/card";
import type { RescoreState } from "@/types/database";
import { STATUSES } from "../ppas/filters";
import { ReportsFilters } from "./reports-filters";
import { ReportList, type ReportListItem } from "./report-list";
import { ReportDetail, type ReportDetailData } from "./report-detail";

const MONITORING_PHOTOS_BUCKET = "monitoring-photos";
const SIGNED_URL_TTL_SECONDS = 60 * 10; // only needs to outlive one page render
const MAX_ROWS = 200;

const STATUS_LABELS: Record<string, string> = Object.fromEntries(
  STATUSES.map((s) => [s.value, s.label])
);

interface ReportsPageProps {
  searchParams: Promise<{ q?: string; inspector?: string; report?: string }>;
}

interface JoinedProject {
  id: string;
  name_of_project: string;
  project_key: string;
  municipality: string | null;
  risk_tier: string | null;
  status: string | null;
}

/** Shape of a row from the dynamic select below. Declared explicitly
 * because passing the column list as a variable (needed for the
 * migration fallback) erases PostgREST's inferred row typing. */
interface RawReport {
  id: string;
  visited_at: string;
  status_observed: string;
  percent_complete: number | null;
  remarks: string | null;
  photo_urls: string[] | null;
  project: JoinedProject | null;
  inspector: { full_name: string | null } | null;
  rescore_state?: RescoreState;
  rescored_at?: string | null;
  rescore_error?: string | null;
}

/**
 * Reports — the full audit trail of every `monitoring_reports` row ever
 * filed (the ML feedback loop's raw input; see actions/submit-report.ts),
 * across every project.
 *
 * Rebuilt as a master-detail workspace on the single-viewport contract
 * shared with Overview, Schedule, and Inspectors. It replaces a
 * seven-column table that could not hold remarks and a photo strip
 * without scrolling sideways, and — more importantly — that signed a
 * Storage URL for EVERY row's photos on EVERY render, up to 200 round
 * trips to populate thumbnails nobody clicked. Only the selected
 * report's photos are signed now.
 *
 * Selection lives in the URL (`?report=`), so a specific report stays
 * linkable, same convention as this portal's other filters.
 */
export default async function ReportsPage({ searchParams }: ReportsPageProps) {
  const params = await searchParams;
  const supabase = await createClient();

  const { data: inspectors } = await supabase
    .from("profiles")
    .select("id, full_name")
    .eq("role", "inspector")
    .order("full_name");

  // The re-score columns only exist once
  // add_monitoring_reports_rescore_state.sql has been run by hand (this
  // repo's migration convention), so the richer select is attempted first
  // and falls back to the original shape. Reports must stay readable on a
  // database that is a migration behind.
  const BASE_COLUMNS =
    "id, visited_at, status_observed, percent_complete, remarks, photo_urls, project:projects(id, name_of_project, project_key, municipality, risk_tier, status), inspector:profiles!monitoring_reports_inspector_id_fkey(full_name)";
  const RESCORE_COLUMNS = `${BASE_COLUMNS}, rescore_state, rescored_at, rescore_error`;

  function buildQuery(columns: string) {
    let q = supabase
      .from("monitoring_reports")
      .select(columns)
      .order("visited_at", { ascending: false })
      .limit(MAX_ROWS);
    if (params.inspector) q = q.eq("inspector_id", params.inspector);
    return q;
  }

  let rescoreTrackingEnabled = true;
  let { data: reportsRaw, error } = await buildQuery(RESCORE_COLUMNS);
  if (error && isMissingColumnError(error)) {
    rescoreTrackingEnabled = false;
    ({ data: reportsRaw, error } = await buildQuery(BASE_COLUMNS));
  }

  // Project-name search filters in memory: the column lives on a joined
  // table, which PostgREST's .ilike() can't reach alongside this join
  // syntax. MAX_ROWS caps it to a bounded scan.
  const allRows = (reportsRaw ?? []) as unknown as RawReport[];
  const filtered = allRows.filter((r) => {
    if (!params.q) return true;
    return r.project?.name_of_project.toLowerCase().includes(params.q.toLowerCase());
  });

  const listItems: ReportListItem[] = filtered.map((r) => ({
    id: r.id,
    visitedAt: r.visited_at,
    inspectorName: r.inspector?.full_name ?? "Unknown",
    projectName: r.project?.name_of_project ?? "Unknown project",
    municipality: r.project?.municipality ?? null,
    statusObserved: r.status_observed,
    statusLabel: STATUS_LABELS[r.status_observed] ?? r.status_observed,
    photoCount: (r.photo_urls ?? []).length,
    rescoreState: rescoreTrackingEnabled ? (r.rescore_state ?? "pending") : null,
  }));

  // Default to the newest report so the detail pane is never empty when
  // there is something to show.
  const selectedId =
    params.report && filtered.some((r) => r.id === params.report)
      ? params.report
      : (filtered[0]?.id ?? null);

  const selectedRaw = filtered.find((r) => r.id === selectedId) ?? null;

  let selected: ReportDetailData | null = null;
  if (selectedRaw) {
    const project = selectedRaw.project;
    const inspector = selectedRaw.inspector;

    // Signed for THIS report only -- the whole point of the rebuild.
    const paths = selectedRaw.photo_urls ?? [];
    let signedPhotoUrls: string[] = [];
    if (paths.length > 0) {
      const { data: signed } = await supabase.storage
        .from(MONITORING_PHOTOS_BUCKET)
        .createSignedUrls(paths, SIGNED_URL_TTL_SECONDS);
      signedPhotoUrls = (signed ?? [])
        .map((s) => s.signedUrl)
        .filter((url): url is string => Boolean(url));
    }

    selected = {
      id: selectedRaw.id,
      visitedAt: selectedRaw.visited_at,
      inspectorName: inspector?.full_name ?? "Unknown",
      projectId: project?.id ?? null,
      projectKey: project?.project_key ?? null,
      projectName: project?.name_of_project ?? "Unknown project",
      municipality: project?.municipality ?? null,
      riskTier: project?.risk_tier ?? null,
      projectStatus: project?.status ?? null,
      projectStatusLabel: project?.status
        ? (STATUS_LABELS[project.status] ?? project.status)
        : null,
      statusObserved: selectedRaw.status_observed,
      statusLabel: STATUS_LABELS[selectedRaw.status_observed] ?? selectedRaw.status_observed,
      percentComplete: selectedRaw.percent_complete,
      remarks: selectedRaw.remarks,
      signedPhotoUrls,
      rescoreState: rescoreTrackingEnabled ? (selectedRaw.rescore_state ?? "pending") : null,
      rescoredAt: selectedRaw.rescored_at ?? null,
      rescoreError: selectedRaw.rescore_error ?? null,
    };
  }

  // Loop health, from the rows already fetched. Reports the newest
  // report's date rather than a "in the last N days" count: it says the
  // same thing about staleness, is more precise about it, and keeps this
  // render a pure function of its data instead of the wall clock.
  const latestVisit = filtered[0]?.visited_at ?? null;
  const awaiting = rescoreTrackingEnabled
    ? filtered.filter((r) => (r.rescore_state ?? "pending") === "pending").length
    : 0;
  const failed = rescoreTrackingEnabled
    ? filtered.filter((r) => r.rescore_state === "failed").length
    : 0;
  const headline =
    filtered.length === 0
      ? "No field reports have been filed yet — the loop's input is empty."
      : [
          `${filtered.length} report${filtered.length === 1 ? "" : "s"}`,
          latestVisit
            ? `latest ${new Date(latestVisit).toLocaleDateString()}`
            : "no dated visits",
          rescoreTrackingEnabled
            ? `${awaiting} awaiting re-score${failed > 0 ? `, ${failed} failed` : ""}`
            : "re-score tracking not enabled",
        ].join(" · ");

  return (
    <div className="flex flex-col gap-3 lg:h-[calc(100dvh-7.25rem)] lg:min-h-135 lg:overflow-hidden">
      <div className="flex shrink-0 flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div>
          <h1 className="text-xl font-semibold text-brand-navy">Reports</h1>
          <p className="text-xs text-slate-500">{headline}</p>
        </div>
        <ReportsFilters inspectors={inspectors ?? []} />
      </div>

      {error && (
        <p className="shrink-0 text-sm text-red-600">Could not load reports: {error.message}</p>
      )}

      <div className="grid gap-3 lg:min-h-0 lg:flex-1 lg:grid-cols-[1fr_1.1fr]">
        <Card className="flex flex-col p-3 lg:min-h-0">
          <div className="min-h-80 flex-1 overflow-y-auto pr-1 lg:min-h-0">
            <ReportList reports={listItems} selectedId={selectedId} />
          </div>
        </Card>

        <Card className="flex flex-col p-4 lg:min-h-0">
          <div className="min-h-80 flex-1 overflow-y-auto pr-1 lg:min-h-0">
            <ReportDetail report={selected} />
          </div>
        </Card>
      </div>
    </div>
  );
}
