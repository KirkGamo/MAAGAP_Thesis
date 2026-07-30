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
import { ShapChart } from "./shap-chart";

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
 * Phase 22 (original): "why was this project classified this way"
 * indicators. At the time this was written, ml-service had no SHAP/
 * feature-importance module and `projects` had no explanation column, so
 * this intentionally stuck to plain-language signals rather than
 * fabricating a numeric attribution.
 *
 * Phase 22 (follow-up): real per-project SHAP values now exist (see
 * ml-service/inference/explain.py and the adjacent "Feature contributions
 * (SHAP)" card, rendered via shap-chart.tsx from
 * `project.shap_top_features`). This function is kept as a deliberately
 * separate, plain-English companion -- not a duplicate -- surfacing the
 * *same real signals* the model consumes as inputs (see ml-service/
 * data_pipeline/feature_engineering.py's engineer_features()): release
 * timing/wet-season flag, elapsed time vs. implementation status,
 * monitoring/field-verification history, budget, and the categorical
 * project type/municipality inputs. Useful on its own merits (readable
 * without SHAP literacy, and still populated for older projects whose
 * `shap_top_features` hasn't been backfilled yet).
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
    // A blank live-app inspector history does NOT mean this project has no
    // monitoring history at all -- `status`/`date_of_completion` come from
    // the historical MONITORING REPORT Con sheet (a monitoring visit
    // recorded there is exactly what established this project's status),
    // it's just that no Inspector has filed a NEW report through this app
    // yet. Saying "no monitoring reports" outright is misleading for a
    // project whose historical record already says Completed -- distinguish
    // the two rather than implying zero monitoring ever happened.
    if (project.status === "completed") {
      indicators.push({
        label: "Field verification",
        detail: `Historical records mark this project Completed${
          project.date_of_completion
            ? ` as of ${new Date(project.date_of_completion).toLocaleDateString("en-PH", {
                month: "long",
                day: "numeric",
                year: "numeric",
              })}`
            : ""
        }, based on a monitoring visit logged in the source dataset -- but no Inspector has filed a follow-up report through this app yet, so it doesn't appear in "Monitoring reports" below.`,
        flagged: false,
      });
    } else {
      indicators.push({
        label: "Field verification",
        detail:
          "No monitoring reports filed yet -- no on-site progress has been recorded for this project.",
        flagged: true,
      });
    }
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
        <CardContent className="flex flex-col gap-3">
          <div className="flex items-center gap-4">
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
          </div>
          {/* Phase 22 follow-up: a project marked Completed in historical
              records can still carry a high risk_tier -- the model is
              scoring "was this delivered on schedule", not "is this
              currently at risk", and a late-but-finished project is exactly
              what a high score correctly describes. That distinction isn't
              obvious from the badge alone, so spell it out here rather than
              leaving the Critical badge looking like it contradicts
              "Completed" (see optimization_engine.py's
              status_confirms_completed exclusion -- this project is already
              excluded from inspector-visit scheduling for the same reason). */}
          {project.status === "completed" && (
            <p className="rounded-md border border-brand-blue/20 bg-brand-blue/5 px-3 py-2 text-sm text-slate-600">
              This project is marked <span className="font-medium">Completed</span> in historical
              records. The score above reflects how much its recorded timeline slipped against a
              standard schedule -- not current, ongoing risk -- and this project is not included
              in the inspector-visit scheduling recommendations for that reason.
            </p>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Why this classification? (plain-English signals)</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-sm text-slate-500">
            These are the same real signals the model consumes as inputs for this specific
            project -- release timing, elapsed time vs. status, field-verification history,
            budget, and its categorical inputs -- described in plain language rather than as
            raw numbers. See &quot;Feature contributions (SHAP)&quot; alongside this card for
            the actual measured contribution of the model&apos;s tree-based half.
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
          <CardTitle>Feature contributions (SHAP)</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-sm text-slate-500">
            Mean of Random Forest&apos;s and XGBoost&apos;s SHAP contributions to their own
            P(RedFlag) output, in percentage points (pp) -- red pushes toward higher risk,
            green pushes toward lower risk. Scoped to the two tree-based base learners; the
            LSTM sequence model isn&apos;t included (see /manager/models for why).
          </p>
          {project.shap_top_features && project.shap_top_features.length > 0 ? (
            <ShapChart features={project.shap_top_features} />
          ) : (
            <p className="text-sm text-slate-400">
              Not yet computed for this project -- SHAP values are attached the next time this
              project is scored (either the next full pipeline/seed run, or its next field
              monitoring update).
            </p>
          )}
        </CardContent>
      </Card>
      </div>

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
