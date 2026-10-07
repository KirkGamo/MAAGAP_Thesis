import { Card } from "@/components/tremor/card";
import { createClient } from "@/lib/supabase/server";
import { Metric, MetricLabel } from "@/components/tremor/metric";
import { mlServiceFetch } from "@/lib/ml-service";

interface TreeModelMetrics {
  test_metrics: { accuracy: number; precision: number; recall: number; f1: number; auc_roc: number };
}

interface RegressionPopulationMetrics {
  n: number;
  mae_days: number | null;
  rmse_days?: number;
  r2?: number | null;
  baseline_mae_days?: number;
  skill_vs_baseline?: number | null;
  mean_observed_delay_days?: number;
}

interface RegressionModelEntry {
  oof_metrics: RegressionPopulationMetrics;
  test_metrics: RegressionPopulationMetrics;
  test_metrics_direct_dates_only: RegressionPopulationMetrics;
  test_metrics_clamped_included: RegressionPopulationMetrics;
}

interface RegressionMetrics {
  target: string;
  units: string;
  n_train: number;
  n_test: number;
  n_features: number;
  clamped_rows_excluded: { train: number; test: number };
  baseline: { description: string; value_days: number };
  models: Record<string, RegressionModelEntry>;
}

interface ModelMetricsResponse {
  tree_models: {
    n_train: number;
    n_test: number;
    n_features: number;
    random_forest: TreeModelMetrics;
    xgboost: TreeModelMetrics;
  } | null;
  lstm: { test_metrics: TreeModelMetrics["test_metrics"]; n_train: number; n_test: number } | null;
  meta_learner: {
    accuracy: number;
    precision: number;
    recall: number;
    f1: number;
    auc_roc: number;
    risk_tier_distribution: Record<string, number>;
  } | null;
  meta_learner_two: {
    accuracy: number;
    precision: number;
    recall: number;
    f1: number;
    auc_roc: number;
    n_test?: number;
    n_train_rows?: number;
  } | null;
  evaluation_populations: {
    three_learner: { n_test: number | null; description: string };
    two_learner: { n_test: number | null; description: string };
    comparable: boolean;
    note: string;
  } | null;
  confusion_matrix: {
    true_positive: number;
    false_positive: number;
    true_negative: number;
    false_negative: number;
  } | null;
  regression: RegressionMetrics | null;
}

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function days(value: number | null | undefined): string {
  return value == null ? "--" : `${value.toFixed(1)} d`;
}

const REGRESSOR_LABELS: Record<string, string> = {
  random_forest_regressor: "Random Forest",
  xgboost_regressor: "XGBoost",
};

/**
 * Phase 12: Models tab, a view-only dashboard over ml-service's real,
 * already-computed validation metrics (see ml-service/main.py's
 * /api/v1/model-metrics for exactly what it reads and why this doesn't
 * trigger a live retrain). This page is a plain Server Component fetch
 * with `cache: "no-store"` -- these numbers should always reflect the
 * most recent training run, not a stale cached response.
 */
/**
 * Which model actually produced the scores managers are looking at.
 *
 * The metrics above describe two models evaluated on different populations.
 * This closes the loop by reporting, from `projects.score_basis`, which of them
 * scored the live population — and in particular the High and Critical tiers,
 * where the answer drives real inspection decisions. Without it the page shows
 * two sets of numbers and leaves the reader to guess which one applies to them.
 */
async function loadScoreBasisSplit() {
  try {
    const supabase = await createClient();
    // Paginated deliberately. An unbounded select() is capped at 1,000 rows by
    // PostgREST with no error, which silently truncated this split to the first
    // 1,000 of 2,393 projects: the page reported 70% (698/1000) and, for the
    // tiers that drive inspection decisions, 80% (20/25). The true figures are
    // 72% (1725/2393) and 76% (76/100) -- and that 76% is the exact number
    // D23-Keep-The-LSTM.md cites as a finding, so the page was contradicting
    // the thesis's own decision record on the screen most likely to be checked
    // against it.
    const PAGE = 1000;
    const data: { risk_tier: string | null; score_basis: string | null }[] = [];
    for (let offset = 0; ; offset += PAGE) {
      const { data: page, error } = await supabase
        .from("projects")
        .select("risk_tier, score_basis")
        .range(offset, offset + PAGE - 1);
      if (error) return null;
      if (!page?.length) break;
      data.push(...page);
      if (page.length < PAGE) break;
    }
    if (data.length === 0) return null;

    const actionable = data.filter(
      (r) => r.risk_tier === "High" || r.risk_tier === "Critical"
    );
    const countTwo = (rows: typeof data) =>
      rows.filter((r) => r.score_basis === "two_learner").length;

    const scored = data.filter((r) => r.score_basis);
    if (scored.length === 0) return null;

    return {
      total: scored.length,
      totalTwo: countTwo(scored),
      actionable: actionable.length,
      actionableTwo: countTwo(actionable),
    };
  } catch {
    // A failed read must not take down the metrics page; the section is simply
    // omitted rather than rendering a misleading zero.
    return null;
  }
}

export default async function ModelsPage() {
  const baseUrl = process.env.FASTAPI_ML_SERVICE_URL;

  if (!baseUrl) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader />
        <Card>
          <p className="text-sm text-slate-500">
            <code>FASTAPI_ML_SERVICE_URL</code> is not configured, so this page can&apos;t reach
            the ML service to read validation results. Set it (e.g.{" "}
            <code>http://localhost:8000</code> for local dev) in <code>frontend/.env.local</code>.
          </p>
        </Card>
      </div>
    );
  }

  let data: ModelMetricsResponse | null = null;
  let errorMessage: string | null = null;

  try {
    const res = await mlServiceFetch("/api/v1/model-metrics");
    if (res.status === 404) {
      errorMessage =
        "No training artifacts found yet -- run train_trees.py, train_lstm.py, and train_meta_learner.py at least once.";
    } else if (!res.ok) {
      errorMessage = `ML service returned ${res.status}.`;
    } else {
      data = (await res.json()) as ModelMetricsResponse;
    }
  } catch (err) {
    errorMessage = `Could not reach the ML service at ${baseUrl}: ${
      err instanceof Error ? err.message : String(err)
    }`;
  }

  if (errorMessage || !data) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader />
        <Card>
          <p className="text-sm text-red-600">{errorMessage}</p>
        </Card>
      </div>
    );
  }

  const {
    tree_models,
    lstm,
    meta_learner,
    meta_learner_two,
    evaluation_populations,
    confusion_matrix,
    regression,
  } = data;
  const pop = evaluation_populations;
  const basis = await loadScoreBasisSplit();

  return (
    <div className="flex flex-col gap-3">
      <PageHeader />

      {/* LEVEL 1 -- the question a reader actually arrives with.
          Before this, the page opened with the three-learner's validation
          metrics: the model that scores a minority of projects, measured on a
          subset, presented as the headline. The deployed reality was the
          seventh card down, below two sets of numbers neither of which
          describes the live population. */}
      {basis && <DeployedReality basis={basis} />}

      {(meta_learner || meta_learner_two) && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {meta_learner && (
            <MetaLearnerCard
              title="Three-learner (RF + XGBoost + LSTM)"
              metrics={meta_learner}
              population={pop?.three_learner.n_test ?? null}
              populationNote={
                pop?.three_learner.description ?? "test rows with an LSTM event sequence"
              }
              caveat="a minority of the predictions this system makes."
            />
          )}
          {meta_learner_two && (
            <MetaLearnerCard
              title="Two-learner (RF + XGBoost)"
              metrics={meta_learner_two}
              population={pop?.two_learner.n_test ?? meta_learner_two.n_test ?? null}
              populationNote={pop?.two_learner.description ?? "test rows"}
              caveat="most of what the system actually scores."
            />
          )}
        </div>
      )}

      {/* The comparison guard, given its own full-width strip rather than
          living inside the second card. It governs how BOTH cards above must
          be read, so it cannot be a footnote attached to one of them.

          D23-Keep-The-LSTM.md records why: the two are evaluated on different
          populations, the naive comparison is confounded, and the valid paired
          test on identical rows returns no significant difference. The external
          UX brief asked for a side-by-side compare control here; it was
          declined for exactly this reason -- see docs/ux-audit.md section 5. */}
      {pop && !pop.comparable && <ComparabilityGuard note={pop.note} />}

      {/* LEVEL 2 -- supporting evidence, collapsed by default. None of it
          answers the opening question, and all of it previously competed with
          the answer at equal visual weight across 2.48 screens. */}

      {tree_models && (
        <Disclosure
          summary="Level 0 learners"
          hint={`${tree_models.n_train} train / ${tree_models.n_test} test rows, ${tree_models.n_features} features`}
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <LearnerBlock name="Random Forest" metrics={tree_models.random_forest.test_metrics} />
            <LearnerBlock name="XGBoost" metrics={tree_models.xgboost.test_metrics} />
          </div>
          {lstm && (
            <div className="mt-4 border-t border-border-subtle pt-4">
              <LearnerBlock name="LSTM (sequence model)" metrics={lstm.test_metrics} />
              <p className="mt-2 text-xs text-field-ink-faint">
                Trained and evaluated on a smaller cohort ({lstm.n_train} train / {lstm.n_test}{" "}
                test) than the tabular models — only projects with a long enough
                monitoring-report history have a usable event sequence (see
                MODEL_IMPROVEMENT_STRATEGY.md).
              </p>
            </div>
          )}
        </Disclosure>
      )}

      {regression && (
        <Disclosure
          summary="Delay magnitude (regression)"
          hint="Objective 2's second half — how late, not just whether late"
        >
          <RegressionCard regression={regression} />
        </Disclosure>
      )}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Glossary />
        {confusion_matrix && (
          <Disclosure summary="Confusion matrix" hint="≥0.5 threshold on meta_prob">
            <ConfusionMatrix matrix={confusion_matrix} />
          </Disclosure>
        )}
      </div>
    </div>
  );
}

/**
 * The page's opening answer: which model actually produced the tiers a manager
 * is looking at, and how much of the actionable caseload it accounts for.
 *
 * This existed before but sat seventh of eight cards, below two sets of
 * validation metrics measured on populations neither of which is the live one.
 * A reader who stopped before reaching it would reasonably have concluded the
 * headline 88.8% described the system's predictions. It does not.
 */
function DeployedReality({
  basis,
}: {
  basis: { total: number; totalTwo: number; actionable: number; actionableTwo: number };
}) {
  const allPct = Math.round((basis.totalTwo / basis.total) * 100);
  const actPct =
    basis.actionable > 0 ? Math.round((basis.actionableTwo / basis.actionable) * 100) : null;
  return (
    <Card className="border-l-4 border-l-brand-sky-dark">
      <MetricLabel>Which model is actually running</MetricLabel>
      <p className="mt-1 text-sm text-field-ink-muted">
        Read from <code>projects.score_basis</code>. Most predictions that drive an
        inspection decision come from the two-learner model, not the full three-learner
        stack — a statement about which model ran, not about accuracy (see below).
      </p>
      <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <StatBlock
          label="All scored projects on two-learner"
          value={`${allPct}% (${basis.totalTwo}/${basis.total})`}
        />
        <StatBlock
          label="High + Critical on two-learner"
          value={actPct == null ? "—" : `${actPct}% (${basis.actionableTwo}/${basis.actionable})`}
        />
      </div>
    </Card>
  );
}

function MetaLearnerCard({
  title,
  metrics,
  population,
  populationNote,
  caveat,
}: {
  title: string;
  metrics: { accuracy: number; precision: number; recall: number; f1: number; auc_roc: number };
  population: number | null;
  populationNote: string;
  caveat: string;
}) {
  return (
    <Card>
      <MetricLabel>{title}</MetricLabel>
      <Metric>{pct(metrics.accuracy)}</Metric>
      {/* The population sits adjacent to the number, not beneath the card. An
          accuracy without the set it was measured on is the single most
          misreadable figure on this page. */}
      <p className="text-xs text-field-ink-muted">
        Accuracy on <span className="font-semibold text-brand-navy">{population ?? "—"}</span>{" "}
        {populationNote} — {caveat}
      </p>
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-field-ink-muted">
        <span>Precision: {pct(metrics.precision)}</span>
        <span>Recall: {pct(metrics.recall)}</span>
        <span>F1: {pct(metrics.f1)}</span>
        <span>AUC-ROC: {pct(metrics.auc_roc)}</span>
      </div>
    </Card>
  );
}

function ComparabilityGuard({ note }: { note: string }) {
  return (
    <div className="border-l-2 border-amber-400 bg-amber-50 px-3 py-2.5 text-sm text-slate-700">
      <span className="font-semibold">These two are not comparable. </span>
      {note}
    </div>
  );
}

/**
 * Native <details>. Chosen over a JS disclosure deliberately: this is a Server
 * Component, so a client accordion would mean a "use client" boundary and a
 * hydration cost for a control the platform already implements --
 * keyboard-operable, screen-reader-announced, and findable by in-page browser
 * search even while collapsed, which a div-with-state is not.
 */
function Disclosure({
  summary,
  hint,
  children,
}: {
  summary: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <details className="group rounded-lg border border-brand-navy/10 bg-white">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-lg px-4 py-2 text-sm font-semibold text-brand-navy focus-visible:ring-2 focus-visible:ring-brand-sky-dark focus-visible:ring-offset-1 focus-visible:outline-none">
        <span className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="text-field-ink-faint transition-transform group-open:rotate-90"
          >
            &rsaquo;
          </span>
          {summary}
        </span>
        {hint && <span className="text-xs font-normal text-field-ink-faint">{hint}</span>}
      </summary>
      <div className="border-t border-border-subtle px-4 py-4">{children}</div>
    </details>
  );
}

/**
 * Plain-language definitions. The audience for this page includes PPDO staff
 * and non-ML panel members, for whom "AUC-ROC 95.8%" is an authoritative-looking
 * number with no meaning attached -- which is worse than no number, because it
 * invites agreement rather than understanding.
 */
function Glossary() {
  const terms: [string, string][] = [
    ["Accuracy", "How often the model's call was right, across every project it scored."],
    [
      "Precision",
      "When it flags a project as at risk, how often it is correct. Low precision wastes inspection trips.",
    ],
    [
      "Recall",
      "Of the projects genuinely at risk, how many it caught. Low recall means at-risk projects go unvisited.",
    ],
    ["F1", "A single score balancing precision and recall, for when one number is needed."],
    [
      "AUC-ROC",
      "How well the model separates at-risk from not-at-risk across every threshold. 50% is a coin toss, 100% is perfect.",
    ],
    [
      "MAE (days)",
      "Average error in days when predicting how late a project will run. Only meaningful against the baseline shown beside it.",
    ],
  ];
  return (
    <Disclosure summary="What these numbers mean" hint="Plain language">
      <dl className="grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2">
        {terms.map(([term, meaning]) => (
          <div key={term}>
            <dt className="text-sm font-semibold text-brand-navy">{term}</dt>
            <dd className="text-sm text-field-ink-muted">{meaning}</dd>
          </div>
        ))}
      </dl>
    </Disclosure>
  );
}

function LearnerBlock({
  name,
  metrics,
}: {
  name: string;
  metrics: TreeModelMetrics["test_metrics"];
}) {
  return (
    <div>
      <p className="text-sm font-semibold text-brand-navy">{name}</p>
      <Metric>{pct(metrics.accuracy)}</Metric>
      <MetricsRow metrics={metrics} />
    </div>
  );
}

function ConfusionMatrix({
  matrix,
}: {
  matrix: {
    true_positive: number;
    false_positive: number;
    true_negative: number;
    false_negative: number;
  };
}) {
  return (
    <div className="grid max-w-md grid-cols-2 gap-2 text-center text-sm">
      <div className="rounded-md bg-emerald-50 p-3">
        <p className="font-semibold text-emerald-800">{matrix.true_positive}</p>
        <p className="text-emerald-700">True Positive</p>
      </div>
      <div className="rounded-md bg-red-50 p-3">
        <p className="font-semibold text-red-800">{matrix.false_positive}</p>
        <p className="text-red-700">False Positive</p>
      </div>
      <div className="rounded-md bg-red-50 p-3">
        <p className="font-semibold text-red-800">{matrix.false_negative}</p>
        <p className="text-red-700">False Negative</p>
      </div>
      <div className="rounded-md bg-emerald-50 p-3">
        <p className="font-semibold text-emerald-800">{matrix.true_negative}</p>
        <p className="text-emerald-700">True Negative</p>
      </div>
    </div>
  );
}

function PageHeader() {
  return (
    <div>
      <h1 className="text-2xl font-semibold text-brand-navy">Models</h1>
      <p className="text-sm text-field-ink-muted">
        Validation performance from the most recent training run.
      </p>
    </div>
  );
}

/**
 * Objective 2's regression half: Mean Absolute Error in days, from
 * train_regressors.py. Three things are shown deliberately rather than just
 * the headline number, because the headline alone is not defensible:
 *
 *  - the constant-predictor baseline it is measured against (an MAE in days
 *    means nothing without one),
 *  - that the Phase 8 clamped rows are excluded, and how many,
 *  - the directly-observed-date subpopulation, where error roughly doubles.
 *
 * That last figure is the honest one and is shown at equal weight, not in a
 * footnote -- it is the measured size of the pipeline's proxy-date dependence.
 */
function RegressionCard({ regression }: { regression: RegressionMetrics }) {
  const entries = Object.entries(regression.models);
  if (entries.length === 0) return null;

  const [bestName, best] = entries.reduce((acc, cur) =>
    (cur[1].test_metrics.mae_days ?? Infinity) < (acc[1].test_metrics.mae_days ?? Infinity)
      ? cur
      : acc,
  );
  const direct = best.test_metrics_direct_dates_only;

  return (
    <div>
      <Metric>{days(best.test_metrics.mae_days)}</Metric>
      <p className="text-xs text-slate-500">
        Mean Absolute Error of the best regressor ({REGRESSOR_LABELS[bestName] ?? bestName}),
        predicting days past the standard duration. Baseline{" "}
        {days(best.test_metrics.baseline_mae_days)} — skill{" "}
        {best.test_metrics.skill_vs_baseline == null
          ? "--"
          : pct(best.test_metrics.skill_vs_baseline)}
        .
      </p>

      <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {entries.map(([name, entry]) => (
          <StatBlock
            key={name}
            label={`${REGRESSOR_LABELS[name] ?? name} MAE`}
            value={days(entry.test_metrics.mae_days)}
          />
        ))}
        <StatBlock label="RMSE" value={days(best.test_metrics.rmse_days)} />
        <StatBlock
          label="R²"
          value={best.test_metrics.r2 == null ? "--" : best.test_metrics.r2.toFixed(3)}
        />
      </div>

      <div className="mt-4 rounded-md bg-amber-50 p-3">
        <p className="text-xs font-semibold text-amber-900">
          On directly-observed completion dates only (n={direct.n}): {days(direct.mae_days)}
        </p>
        <p className="mt-1 text-xs text-amber-800">
          Error roughly doubles and R² turns negative on the {direct.n} test projects whose
          completion date was recorded directly rather than recovered by proxy. About 92–94% of the
          labelled population relies on a proxy date, so this figure is the measured size of that
          dependence — the model is substantially learning the recovery mechanism, not delay alone.
          That subpopulation is also small and differently distributed (it finishes well inside the
          standard duration), so neither number should be read on its own.
        </p>
      </div>

      <p className="mt-3 text-xs text-slate-400">
        {regression.n_train} train / {regression.n_test} test rows over {regression.n_features}{" "}
        features. Excludes {regression.clamped_rows_excluded.train} train and{" "}
        {regression.clamped_rows_excluded.test} test rows whose actual duration is pinned by the
        Phase 8 clamp rather than observed — including them would deflate the target and flatter
        this number.
      </p>
    </div>
  );
}

function StatBlock({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-slate-500">{label}</p>
      <p className="text-lg font-semibold text-brand-navy">{value}</p>
    </div>
  );
}

function MetricsRow({ metrics }: { metrics: TreeModelMetrics["test_metrics"] }) {
  return (
    <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-500">
      <span>Precision: {pct(metrics.precision)}</span>
      <span>Recall: {pct(metrics.recall)}</span>
      <span>F1: {pct(metrics.f1)}</span>
      <span>AUC-ROC: {pct(metrics.auc_roc)}</span>
    </div>
  );
}
