import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, riskTierVariant } from "@/components/ui/badge";
import { AlertTriangle, Info } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Database } from "@/types/database";

interface ProjectDetailPageProps {
  params: Promise<{ projectId: string }>;
}

const MONITORING_PHOTOS_BUCKET = "monitoring-photos";
const SIGNED_URL_TTL_SECONDS = 60 * 10; // 10 minutes: only needs to outlive one page render

const STATUS_LABELS: Record<string, string> = {
  not_yet_implemented: "Not Yet Implemented",
  for_bidding: "For Bidding",
  on_going: "On-going",
  completed: "Completed",
};

type ProjectRow = Database["public"]["Tables"]["projects"]["Row"];

interface RiskIndicator {
  label: string;
  detail: string;
  flagged: boolean;
}

/**
 * Phase 22: "why was this project classified this way" indicators, added
 * per an explicit request to explain the risk tier on this page. This is
 * deliberately NOT a claim of per-project feature attribution (e.g. SHAP
 * values) -- the ml-service pipeline (Random Forest + XGBoost + LSTM into
 * a multinomial logistic regression meta-learner) doesn't compute or store
 * one anywhere (checked ml-service/ for a shap/explain/feature_importance
 * module and the `projects` table for an explanation column; neither
 * exists). Fabricating a numeric attribution breakdown here would misstate
 * what the model actually produces, which this project's own guidelines
 * are explicit about avoiding.
 *
 * Instead, this surfaces the *same real signals* the model consumes as
 * inputs for this specific project (see ml-service/data_pipeline/
 * feature_engineering.py's engineer_features()): release timing/wet-season
 * flag, elapsed time vs. implementation status, monitoring/field-
 * verification history, budget, and the categorical project type/
 * municipality inputs -- so a Manager can judge for themselves which ones
 * plausibly line up with the assigned tier, honestly labeled as inputs
 * rather than a decomposition of the probability itself.
 */
function buildRiskIndicators(
  project: ProjectRow,
  reports: { visited_at: string; percent_complete: number | null }[]
): RiskIndicator[] {
  const indicators: RiskIndicator[] = [];

  if (project.date_released) {
    const released = new Date(project.date_released);
    const daysSinceRelease = Math.floor((Date.now() - released.getTime()) / 86_400_000);
    const month = released.getMonth() + 1;
    // Matches ml-service's is_wet_season_release feature exactly:
    // months.isin([6, 7, 8, 9, 10, 11]) -- June through November.
    const isWetSeason = month >= 6 && month <= 11;
    indicators.push({
      label: "Release timing",
      detail: `Released ${released.toLocaleDateString("en-PH", {
        month: "long",
        day: "numeric",
        year: "numeric",
      })} (${daysSinceRelease.toLocaleString()} days ago)${
        isWetSeason
          ? " -- during the wet season (June-November), one of the model's engineered input features."
          : "."
      }`,
      flagged: isWetSeason,
    });

    if (project.status === "not_yet_implemented" || project.status === "for_bidding") {
      const stalled = daysSinceRelease > 90;
      indicators.push({
        label: "Implementation start",
        detail: `Still marked "${STATUS_LABELS[project.status] ?? project.status}" ${daysSinceRelease.toLocaleString()} days after release${
          stalled ? " -- a delayed start relative to most projects in this dataset." : "."
        }`,
        flagged: stalled,
      });
    }
  } else {
    indicators.push({
      label: "Release timing",
      detail: "No release date on record.",
      flagged: false,
    });
  }

  const latestReport = reports[0];
  if (!latestReport) {
    indicators.push({
      label: "Field verification",
      detail:
        "No monitoring reports filed yet -- no on-site progress has been recorded for this project.",
      flagged: true,
    });
  } else {
    indicators.push({
      label: "Field verification",
      detail: `${reports.length} monitoring report(s) filed. Most recent: ${
        latestReport.percent_complete != null
          ? `${latestReport.percent_complete}% complete`
          : "no completion percentage recorded"
      } as of ${new Date(latestReport.visited_at).toLocaleDateString()}.`,
      flagged: false,
    });
  }

  if (project.amount_php != null) {
    indicators.push({
      label: "Budget",
      detail: `₱${project.amount_php.toLocaleString()} -- one of the model's numeric inputs.`,
      flagged: false,
    });
  }

  indicators.push({
    label: "Classification inputs",
    detail: `Project type: ${project.project_type ?? "Unclassified"}. Municipality: ${
      project.municipality ?? "not on record"
    }. Both are categorical (one-hot encoded) inputs to the model.`,
    flagged: false,
  });

  return indicators;
}

/** Manager-facing detail view: project metadata plus every monitoring
 * report an Inspector has filed against it (the ML feedback loop's output —
 * see actions/submit-report.ts). Phase 12: moved from
 * /manager/backlog/[projectId] to /manager/ppas/[projectId] as part of
 * the Backlog -> PPAs rename; content unchanged.
 *
 * `monitoring_reports.photo_urls` stores Supabase Storage *paths*, not
 * signed URLs (the `monitoring-photos` bucket is private — see
 * supabase/storage_monitoring_photos.sql) — a signed URL minted once at
 * upload time would expire a fixed number of days later regardless of when
 * a Manager actually opens this page. Instead, every render re-signs each
 * report's paths fresh, right here, server-side. */
export default async function ProjectDetailPage({ params }: ProjectDetailPageProps) {
  const { projectId } = await params;
  const supabase = await createClient();

  const { data: project } = await supabase
    .from("projects")
    .select("*")
    .eq("id", projectId)
    .single();

  if (!project) notFound();

  const { data: reportsRaw } = await supabase
    .from("monitoring_reports")
    .select("id, visited_at, status_observed, percent_complete, remarks, photo_urls")
    .eq("project_id", projectId)
    .order("visited_at", { ascending: false });

  // Re-sign every stored path in one batched call per report rather than
  // N individual createSignedUrl calls. RLS on storage.objects (see
  // storage_monitoring_photos.sql's "managers read all" policy) still
  // governs whether this Manager is allowed to read these paths at all --
  // signing doesn't bypass that.
  const reports = await Promise.all(
    (reportsRaw ?? []).map(async (r) => {
      const paths = r.photo_urls ?? [];
      if (paths.length === 0) return { ...r, signedPhotoUrls: [] as string[] };

      const { data: signed } = await supabase.storage
        .from(MONITORING_PHOTOS_BUCKET)
        .createSignedUrls(paths, SIGNED_URL_TTL_SECONDS);

      const signedPhotoUrls = (signed ?? [])
        .map((s) => s.signedUrl)
        .filter((url): url is string => Boolean(url));

      return { ...r, signedPhotoUrls };
    })
  );

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-brand-navy">{project.name_of_project}</h1>
        <p className="text-sm text-slate-500">
          {project.project_key} · {project.location}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Risk assessment</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center gap-4">
          {project.risk_tier ? (
            <Badge variant={riskTierVariant(project.risk_tier)}>{project.risk_tier}</Badge>
          ) : (
            <span className="text-sm text-slate-400">Not yet scored</span>
          )}
          {project.risk_probability != null && (
            <span className="text-sm text-slate-600">
              P(RedFlag) = {project.risk_probability.toFixed(3)}
            </span>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Why this classification?</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-sm text-slate-500">
            The prediction pipeline (a Random Forest + XGBoost + LSTM stacking ensemble feeding a
            multinomial logistic regression meta-learner) doesn&apos;t compute or store a
            per-project feature-attribution breakdown (e.g. SHAP values) -- see /manager/models for
            the model&apos;s aggregate accuracy/precision/recall instead. What follows are the same
            real signals the model consumes as inputs for this specific project, so you can judge
            which ones plausibly line up with the assigned tier; they are inputs the model saw, not
            a mathematical decomposition of the
            {project.risk_probability != null
              ? ` ${(project.risk_probability * 100).toFixed(1)}%`
              : ""}{" "}
            P(RedFlag) figure itself.
          </p>
          <ul className="flex flex-col gap-2">
            {buildRiskIndicators(project, reports ?? []).map((indicator) => (
              <li
                key={indicator.label}
                className={`flex items-start gap-2.5 rounded-md border px-3 py-2 text-sm ${
                  indicator.flagged
                    ? "border-amber-200 bg-amber-50"
                    : "border-brand-navy/10 bg-white"
                }`}
              >
                {indicator.flagged ? (
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden="true" />
                ) : (
                  <Info className="mt-0.5 size-4 shrink-0 text-brand-blue" aria-hidden="true" />
                )}
                <div>
                  <span className="font-medium text-brand-navy">{indicator.label}:</span>{" "}
                  <span className="text-slate-600">{indicator.detail}</span>
                </div>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Monitoring reports ({reports?.length ?? 0})</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Visited</TableHead>
                <TableHead>Status observed</TableHead>
                <TableHead>% complete</TableHead>
                <TableHead>Remarks</TableHead>
                <TableHead>Photos</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(reports ?? []).map((r) => (
                <TableRow key={r.id}>
                  <TableCell>{new Date(r.visited_at).toLocaleDateString()}</TableCell>
                  <TableCell className="capitalize">{r.status_observed.replaceAll("_", " ")}</TableCell>
                  <TableCell>{r.percent_complete != null ? `${r.percent_complete}%` : "—"}</TableCell>
                  <TableCell className="max-w-xs truncate">{r.remarks ?? "—"}</TableCell>
                  <TableCell>
                    {r.signedPhotoUrls.length > 0 ? (
                      <div className="flex gap-1.5">
                        {r.signedPhotoUrls.map((url, i) => (
                          <a key={i} href={url} target="_blank" rel="noopener noreferrer">
                            {/* eslint-disable-next-line @next/next/no-img-element -- freshly-signed remote URL from Supabase Storage, not a static/local asset next/image can optimize */}
                            <img
                              src={url}
                              alt={`Site photo ${i + 1}`}
                              className="size-10 rounded border border-brand-navy/10 object-cover"
                            />
                          </a>
                        ))}
                      </div>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {(reports ?? []).length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-slate-400">
                    No field reports filed yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
