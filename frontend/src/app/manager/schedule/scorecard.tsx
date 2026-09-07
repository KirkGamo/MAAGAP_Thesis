/**
 * The optimizer scorecard: renders optimization_engine.py's summary JSON
 * (served through GET /api/v1/latest-schedule, fetched server-side by
 * page.tsx) as a row of compact chips. This information was previously
 * fetched by the deploy action and thrown away -- for a thesis whose
 * Objective 3 is prescriptive resource allocation, the solve's quality
 * (status, coverage, critical projects reached, travel clusters) must be
 * visible, not buried in a CSV sidecar.
 *
 * Degrades honestly: when the ML service is unreachable (the normal state
 * for a deployed frontend without the FastAPI sidecar), page.tsx passes
 * null and a single muted chip explains why -- never an error state.
 */

export interface OptimizerSummary {
  solver_status?: string;
  objective_value?: number;
  candidate_projects?: number;
  projects_scheduled?: number;
  coverage_rate?: number;
  critical_projects_scheduled?: number;
  clusters_touched?: number;
}

function Chip({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-baseline gap-1.5 rounded-md border border-brand-navy/10 bg-white px-2 py-1">
      <span className="text-xs font-semibold text-brand-navy">{value}</span>
      <span className="text-[11px] text-slate-500">{label}</span>
    </span>
  );
}

export function Scorecard({ summary }: { summary: OptimizerSummary | null }) {
  if (!summary) {
    return (
      <span className="rounded-md border border-dashed border-brand-navy/15 px-2 py-1 text-[11px] text-slate-400">
        Optimizer output unavailable — ML service not reachable
      </span>
    );
  }

  const coverage =
    summary.coverage_rate != null ? `${Math.round(summary.coverage_rate * 100)}%` : "—";

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Chip label="solver" value={summary.solver_status ?? "—"} />
      <Chip
        label="scheduled"
        value={`${summary.projects_scheduled ?? "—"}/${summary.candidate_projects ?? "—"}`}
      />
      <Chip label="coverage" value={coverage} />
      <Chip label="Critical covered" value={String(summary.critical_projects_scheduled ?? "—")} />
      <Chip label="clusters" value={String(summary.clusters_touched ?? "—")} />
    </div>
  );
}
