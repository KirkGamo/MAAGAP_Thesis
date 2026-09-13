import { Card } from "@/components/tremor/card";
import { Metric, MetricLabel } from "@/components/tremor/metric";

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
    const res = await fetch(`${baseUrl}/api/v1/model-metrics`, { cache: "no-store" });
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

  const { tree_models, lstm, meta_learner, confusion_matrix, regression } = data;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader />

      {meta_learner && (
        <Card>
          <MetricLabel>Meta-learner (final ensemble) — test set</MetricLabel>
          <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-5">
            <StatBlock label="Accuracy" value={pct(meta_learner.accuracy)} />
            <StatBlock label="Precision" value={pct(meta_learner.precision)} />
            <StatBlock label="Recall" value={pct(meta_learner.recall)} />
            <StatBlock label="F1" value={pct(meta_learner.f1)} />
            <StatBlock label="AUC-ROC" value={pct(meta_learner.auc_roc)} />
          </div>
          <div className="mt-4 flex flex-wrap gap-3 text-sm text-slate-500">
            {Object.entries(meta_learner.risk_tier_distribution).map(([tier, count]) => (
              <span key={tier}>
                {tier}: <span className="font-medium text-brand-navy">{count}</span>
              </span>
            ))}
          </div>
        </Card>
      )}

      {confusion_matrix && (
        <Card>
          <MetricLabel>
            Confusion matrix (test set, {"≥"}0.5 decision threshold on meta_prob)
          </MetricLabel>
          <div className="mt-3 grid max-w-md grid-cols-2 gap-2 text-center text-sm">
            <div className="rounded-md bg-emerald-50 p-3">
              <p className="font-semibold text-emerald-800">{confusion_matrix.true_positive}</p>
              <p className="text-emerald-700">True Positive</p>
            </div>
            <div className="rounded-md bg-red-50 p-3">
              <p className="font-semibold text-red-800">{confusion_matrix.false_positive}</p>
              <p className="text-red-700">False Positive</p>
            </div>
            <div className="rounded-md bg-red-50 p-3">
              <p className="font-semibold text-red-800">{confusion_matrix.false_negative}</p>
              <p className="text-red-700">False Negative</p>
            </div>
            <div className="rounded-md bg-emerald-50 p-3">
              <p className="font-semibold text-emerald-800">{confusion_matrix.true_negative}</p>
              <p className="text-emerald-700">True Negative</p>
            </div>
          </div>
        </Card>
      )}

      {regression && <RegressionCard regression={regression} />}

      {tree_models && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Card>
            <MetricLabel>Random Forest (Level 0) — test set</MetricLabel>
            <Metric>{pct(tree_models.random_forest.test_metrics.accuracy)}</Metric>
            <MetricsRow metrics={tree_models.random_forest.test_metrics} />
          </Card>
          <Card>
            <MetricLabel>XGBoost (Level 0) — test set</MetricLabel>
            <Metric>{pct(tree_models.xgboost.test_metrics.accuracy)}</Metric>
            <MetricsRow metrics={tree_models.xgboost.test_metrics} />
          </Card>
        </div>
      )}

      {lstm && (
        <Card>
          <MetricLabel>LSTM (Level 0, sequence model) — test set</MetricLabel>
          <Metric>{pct(lstm.test_metrics.accuracy)}</Metric>
          <MetricsRow metrics={lstm.test_metrics} />
          <p className="mt-2 text-xs text-slate-400">
            Trained/evaluated on a smaller cohort ({lstm.n_train} train / {lstm.n_test} test) than
            the tabular models — only projects with a long enough monitoring-report history have a
            usable event sequence (see MODEL_IMPROVEMENT_STRATEGY.md).
          </p>
        </Card>
      )}
    </div>
  );
}

function PageHeader() {
  return (
    <div>
      <h1 className="text-2xl font-semibold text-brand-navy">Models</h1>
      <p className="text-sm text-slate-500">
        Validation performance of the Level 0 (Random Forest, XGBoost, LSTM) and Level 1
        (meta-learner) stack, from the most recent training run.
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
    <Card>
      <MetricLabel>Delay magnitude (regression) — test set</MetricLabel>
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
    </Card>
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
