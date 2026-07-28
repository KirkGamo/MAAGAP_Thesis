import { Card } from "@/components/tremor/card";
import { Metric, MetricLabel } from "@/components/tremor/metric";

interface TreeModelMetrics {
  test_metrics: { accuracy: number; precision: number; recall: number; f1: number; auc_roc: number };
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
}

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

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

  const { tree_models, lstm, meta_learner, confusion_matrix } = data;

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
