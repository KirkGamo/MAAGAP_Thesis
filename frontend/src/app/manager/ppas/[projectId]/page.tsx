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
  refunded: "Refunded",
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
    } else if (project.status === "refunded") {
      indicators.push({
        label: "Field verification",
        detail:
          "Historical records mark this project's fund transfer as Refunded -- the funds were returned rather than implemented, so no on-site progress was ever expected. No Inspector report has been filed through this app for it.",
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

  // R4: the last few scores, newest first. The projects row is overwritten on
  // every re-score, so without this the page can say what the risk IS and never
  // what it WAS -- and those are different operational facts.
  //
  // Tolerates the table not existing: the migration
  // (supabase/add_project_score_history.sql) may not be applied yet, and a page
  // that cannot read history should omit the section rather than fail the route.
  const { data: scoreHistory } = await supabase
    .from("project_score_history")
    .select("scored_at, risk_tier, risk_probability, score_basis, source, monitoring_report_id")
    .eq("project_id", projectId)
    .order("scored_at", { ascending: false })
    .limit(10);

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
          {project.date_last_monitored && (
            <>
              {" "}
              · Last monitored{" "}
              {new Date(project.date_last_monitored).toLocaleDateString("en-PH", {
                month: "long",
                day: "numeric",
                year: "numeric",
              })}
            </>
          )}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Risk assessment</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <RiskBand
            tier={project.risk_tier}
            probability={project.risk_probability}
            scoreBasis={project.score_basis}
            history={scoreHistory}
          />
          <ScoreHistoryNote history={scoreHistory} />
          {/* Phase 22 follow-up: a project marked Completed (or, as of the
              "refunded" status addition, Refunded) in historical records can
              still carry a high risk_tier -- the model is scoring "was this
              delivered on schedule", not "is this currently at risk," and a
              late-but-finished (or abandoned/refunded) project is exactly
              what a high score correctly describes. That distinction isn't
              obvious from the badge alone, so spell it out here rather than
              leaving the badge looking like it contradicts the status (see
              optimization_engine.py's status_excludes_scheduling exclusion
              -- this project is already excluded from inspector-visit
              scheduling for the same reason). */}
          {project.status === "completed" && (
            <p className="rounded-md border border-brand-blue/20 bg-brand-blue/5 px-3 py-2 text-sm text-slate-600">
              This project is marked <span className="font-medium">Completed</span> in historical
              records. The score above reflects how much its recorded timeline slipped against a
              standard schedule -- not current, ongoing risk -- and this project is not included
              in the inspector-visit scheduling recommendations for that reason.
            </p>
          )}
          {project.status === "refunded" && (
            <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-slate-600">
              This project&apos;s fund transfer is marked <span className="font-medium">Refunded</span>{" "}
              in historical records -- the funds were returned rather than implemented. The score
              above still reflects the model&apos;s read of the available data, but this project is
              not included in the inspector-visit scheduling recommendations, since there is no
              active work to verify on-site.
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
              Feature contributions are precomputed for High and Critical projects, where the
              reasoning behind a score is most likely to be acted on. This project is below that
              threshold, so no SHAP breakdown is stored — the risk indicators above describe the
              same underlying signals in plain language. A contribution breakdown is attached
              automatically if this project is ever scored High or Critical.
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

/* ---------------------------------------------------------------------------
 * R4: risk LEVEL versus risk CHANGE.
 *
 * `projects.risk_probability` is overwritten on every re-score, so a project
 * that jumped from 0.30 to 0.94 this week and one that has sat at 0.94 for six
 * months looked identical on this page. They are not the same situation and
 * they do not warrant the same response.
 *
 * The delta also surfaces a property of the model that the manuscript has to
 * disclose anyway: a live re-score responds to elapsed time as much as to what
 * the inspector observed. PRJ_9601 moved High -> Critical on a report that left
 * the status unchanged and advanced only the visit date. Showing the change
 * next to the level is what lets a manager tell "newly escalated" from
 * "chronically overdue" -- and `monitoring_report_id` records which of the two
 * a given movement was.
 * ------------------------------------------------------------------------ */

type ScoreHistoryRow = {
  scored_at: string;
  risk_tier: string | null;
  risk_probability: number | null;
  score_basis: string | null;
  source: string;
  monitoring_report_id: string | null;
};

function RiskDelta({ history }: { history: ScoreHistoryRow[] | null }) {
  // Two scored points are needed for a change to exist at all. One point is
  // not "no change" -- it is "not yet known", and saying 0.000 would be a
  // fabricated reassurance.
  const scored = (history ?? []).filter((h) => h.risk_probability != null);
  if (scored.length < 2) return null;

  const delta = scored[0].risk_probability! - scored[1].risk_probability!;
  if (Math.abs(delta) < 0.0005) {
    return <span className="text-sm text-slate-500">unchanged since last score</span>;
  }

  const rose = delta > 0;
  return (
    <span
      className={`text-sm font-medium ${rose ? "text-red-700" : "text-emerald-700"}`}
      title={`Previous: ${scored[1].risk_probability!.toFixed(3)} on ${new Date(
        scored[1].scored_at
      ).toLocaleDateString()}`}
    >
      {rose ? "▲" : "▼"} {rose ? "+" : ""}
      {delta.toFixed(3)} since last score
    </span>
  );
}

function ScoreHistoryNote({ history }: { history: ScoreHistoryRow[] | null }) {
  const scored = (history ?? []).filter((h) => h.risk_probability != null);
  if (scored.length < 2) return null;

  const latest = scored[0];
  const previous = scored[1];
  const delta = latest.risk_probability! - previous.risk_probability!;
  if (Math.abs(delta) < 0.0005) return null;

  const tierChanged = latest.risk_tier !== previous.risk_tier;
  // A re-score triggered by a report is attributable to an observation; one
  // without is attributable to elapsed time, because the only inputs that moved
  // were the time-since features. This is the honest answer to "did the system
  // respond to the inspector, or to the calendar?"
  const fromReport = latest.monitoring_report_id != null;

  return (
    <p className="border-l-2 border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-600">
      {tierChanged && (
        <>
          Tier moved{" "}
          <span className="font-medium text-brand-navy">
            {previous.risk_tier} → {latest.risk_tier}
          </span>
          .{" "}
        </>
      )}
      {fromReport
        ? "This change followed a monitoring report. Where the reported status matched the previous status, the movement comes from elapsed-time features rather than from what was observed on site."
        : "This change came from a scheduled re-score, not a site visit — so it reflects elapsed time rather than new field observation."}
    </p>
  );
}

/* ---------------------------------------------------------------------------
 * The risk band.
 *
 * Tier, probability, change and provenance were four sibling spans in a flex
 * row — the page's headline fact rendered as a sentence fragment. They are one
 * unit here, because they answer one question together: how bad is this, which
 * way is it moving, and who says so.
 *
 * `score_basis` appears for the first time. It has been persisted since R4 and
 * shown nowhere, which mattered more than it sounds: 76% of High and Critical
 * classifications come from the two-learner configuration, so a manager reading
 * a Critical tier could not tell which model produced it.
 * ------------------------------------------------------------------------ */

function RiskBand({
  tier,
  probability,
  scoreBasis,
  history,
}: {
  tier: string | null;
  probability: number | null;
  scoreBasis: string | null;
  history: ScoreHistoryRow[] | null;
}) {
  const scored = (history ?? []).filter((h) => h.risk_probability != null);

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border-subtle bg-surface-sunk px-4 py-3.5">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="flex items-center gap-3">
          {tier ? (
            <Badge variant={riskTierVariant(tier)} className="text-sm">
              {tier}
            </Badge>
          ) : (
            <span className="text-sm text-slate-400">Not yet scored</span>
          )}
          {probability != null && (
            <div className="flex items-baseline gap-1.5">
              <span className="text-2xl leading-none font-semibold text-brand-navy tabular-nums">
                {probability.toFixed(3)}
              </span>
              <span className="text-xs text-slate-500">P(RedFlag)</span>
            </div>
          )}
        </div>

        <RiskDelta history={history} />
        <Sparkline history={history} />
      </div>

      <ScoreBasisLine basis={scoreBasis} count={scored.length} />
    </div>
  );
}

/**
 * The score series, oldest to newest, with the current value marked.
 *
 * Renders only from two points. A single point is not a flat line — it is an
 * unknown trajectory, and drawing it as flat would assert something the data
 * does not say.
 */
function Sparkline({ history }: { history: ScoreHistoryRow[] | null }) {
  const points = (history ?? [])
    .filter((h) => h.risk_probability != null)
    .slice()
    .reverse(); // stored newest-first; a chart reads oldest-first

  if (points.length < 2) return null;

  const W = 112;
  const H = 30;
  const PAD = 3;
  const values = points.map((p) => Number(p.risk_probability));

  // Fixed 0..1 domain rather than min..max of the series. An autoscaled axis
  // would render a drift from 0.93 to 0.94 as a dramatic climb, which is the
  // classic way a sparkline lies about a probability.
  const x = (i: number) => PAD + (i / (points.length - 1)) * (W - 2 * PAD);
  const y = (v: number) => H - PAD - v * (H - 2 * PAD);

  const path = values.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const last = values[values.length - 1];

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width={W}
      height={H}
      className="shrink-0 overflow-visible"
      role="img"
      aria-label={`Risk probability over the last ${points.length} scores, currently ${last.toFixed(3)} on a 0 to 1 scale`}
    >
      <line
        x1={PAD} y1={y(0.5)} x2={W - PAD} y2={y(0.5)}
        className="stroke-slate-300" strokeWidth="1" strokeDasharray="2 2"
      />
      <path d={path} fill="none" className="stroke-brand-sky-dark" strokeWidth="1.5"
        strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(points.length - 1)} cy={y(last)} r="2.5" className="fill-brand-navy" />
    </svg>
  );
}

/**
 * Which model produced the score on screen.
 *
 * Named in full rather than by the raw `score_basis` value: "two_learner" is a
 * column value, not an explanation, and the distinction it carries — whether
 * this project had an event sequence long enough for the LSTM — is the reason
 * the Models page shows two sets of metrics.
 */
function ScoreBasisLine({ basis, count }: { basis: string | null; count: number }) {
  if (!basis) return null;

  const three = basis === "three_learner";
  return (
    <p className="border-t border-border-subtle pt-3 text-xs leading-relaxed text-slate-500">
      Scored by the{" "}
      <span className="font-medium text-slate-700">
        {three ? "three-learner" : "two-learner"}
      </span>{" "}
      ensemble —{" "}
      {three
        ? "Random Forest, XGBoost and the LSTM, which this project has a long enough monitoring-event sequence to use."
        : "Random Forest and XGBoost. This project has no monitoring-event sequence long enough for the LSTM, which is true of most of the portfolio."}
      {count > 1 && ` ${count} scores on record.`}
    </p>
  );
}
