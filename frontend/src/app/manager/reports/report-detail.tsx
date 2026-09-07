import Link from "next/link";
import { Badge, riskTierVariant, statusVariant } from "@/components/ui/badge";
import { RescorePanel } from "./rescore-badge";
import type { RescoreState } from "@/types/database";

export interface ReportDetailData {
  id: string;
  visitedAt: string;
  inspectorName: string;
  projectId: string | null;
  projectKey: string | null;
  projectName: string;
  municipality: string | null;
  riskTier: string | null;
  /** The project's status now. The report's own observation is below; the
   * two differing is meaningful, so both are shown rather than merged. */
  projectStatus: string | null;
  projectStatusLabel: string | null;
  statusObserved: string;
  statusLabel: string;
  percentComplete: number | null;
  remarks: string | null;
  /** Freshly signed for this render only -- see page.tsx. */
  signedPhotoUrls: string[];
  /** Null when the re-score tracking migration hasn't been applied. */
  rescoreState: RescoreState | null;
  rescoredAt: string | null;
  rescoreError: string | null;
}

/**
 * The detail half of the Reports workspace: everything about one report
 * that could not fit in the old table's columns, including full remarks
 * and photos at a size worth looking at.
 *
 * Photos are signed by the page for THIS report alone. The previous
 * table signed every row's photos on every render -- up to 200 storage
 * round trips to populate thumbnails most of which nobody clicked.
 */
export function ReportDetail({ report }: { report: ReportDetailData | null }) {
  if (!report) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <p className="max-w-xs text-center text-sm text-slate-400">
          Select a report to see its remarks, photos, and what it changed on the project.
        </p>
      </div>
    );
  }

  // Composed as a plain string: this repo's Next build fuses JSX boundary
  // whitespace around entities.
  const filedLine =
    `${new Date(report.visitedAt).toLocaleString()} · ${report.inspectorName}` +
    (report.municipality ? ` · ${report.municipality}` : "");

  const observationDiffers =
    report.projectStatus != null && report.projectStatus !== report.statusObserved;

  return (
    <div className="flex flex-col gap-3">
      <div>
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-semibold text-brand-navy">{report.projectName}</p>
          {report.riskTier && (
            <Badge variant={riskTierVariant(report.riskTier)} className="shrink-0">
              {report.riskTier}
            </Badge>
          )}
        </div>
        <p className="mt-0.5 text-[11px] text-slate-500">{filedLine}</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] text-slate-500">Observed</span>
        <Badge variant={statusVariant(report.statusObserved)}>{report.statusLabel}</Badge>
        {report.projectStatusLabel && (
          <>
            <span className="text-[11px] text-slate-400">·</span>
            <span className="text-[11px] text-slate-500">Project now</span>
            <Badge variant={statusVariant(report.projectStatus ?? "")}>
              {report.projectStatusLabel}
            </Badge>
          </>
        )}
      </div>

      {observationDiffers && (
        <p className="rounded-md border border-orange-200 bg-orange-50 p-2 text-[11px] leading-relaxed text-orange-700">
          The project&apos;s current status differs from what this visit observed — either a later
          report superseded it, or this observation was never applied.
        </p>
      )}

      {report.rescoreState && (
        <RescorePanel
          reportId={report.id}
          state={report.rescoreState}
          rescoredAt={report.rescoredAt}
          error={report.rescoreError}
        />
      )}

      {report.percentComplete != null && (
        <p className="text-[11px] text-slate-500">
          {`Reported ${report.percentComplete}% complete (recorded for audit only — not a model input).`}
        </p>
      )}

      {report.remarks && (
        <div>
          <p className="text-[11px] font-medium text-slate-500">Remarks</p>
          <p className="mt-0.5 whitespace-pre-wrap text-sm text-slate-700">{report.remarks}</p>
        </div>
      )}

      {report.signedPhotoUrls.length > 0 && (
        <div>
          <p className="mb-1 text-[11px] font-medium text-slate-500">
            {`Site photos (${report.signedPhotoUrls.length})`}
          </p>
          <div className="grid grid-cols-3 gap-2">
            {report.signedPhotoUrls.map((url, i) => (
              <a key={i} href={url} target="_blank" rel="noopener noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element -- freshly-signed Supabase Storage URL, not a static asset next/image can optimize */}
                <img
                  src={url}
                  alt={`Site photo ${i + 1}`}
                  className="h-24 w-full rounded-md border border-brand-navy/10 object-cover"
                />
              </a>
            ))}
          </div>
        </div>
      )}

      {report.projectId && (
        <Link
          href={`/manager/ppas/${report.projectId}`}
          className="mt-auto self-start rounded-md border border-brand-navy/15 px-2.5 py-1 text-xs font-medium text-brand-navy transition-colors hover:bg-brand-surface"
        >
          Open PPA
        </Link>
      )}
    </div>
  );
}
