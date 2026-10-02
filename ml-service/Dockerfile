# MAAGAP ML microservice — production image
# =============================================================================
# BUILD FROM THE REPOSITORY ROOT, NOT FROM ml-service/:
#
#     docker build -f ml-service/Dockerfile -t maagap-ml:latest .
#
# This is not a stylistic preference. ml-service/inference/live_scoring.py and
# optimization_engine.py both resolve their data directory as
#
#     DATA_READY_DIR = REPO_ROOT / "data" / "ready"      # REPO_ROOT = ml-service/..
#
# so data/ready/ lives one level ABOVE the service, outside any build context
# rooted at ml-service/. The image therefore mirrors the repository layout
# (/app/ml-service + /app/data/ready) rather than flattening it, because
# flattening would mean patching path constants to suit the container -- and a
# path that differs between local and deployed is a class of bug this project
# has already paid for once, in map coordinates that drifted 44 km because the
# same quantity was derived two different ways.
#
# WHAT IS BAKED IN
# -----------------------------------------------------------------------------
# ~15 MB of trained models and prepared data, because both ml-service/artifacts/
# and data/ready/ are gitignored -- they are model binaries and derived data,
# not source -- so a container built from a clone would otherwise have no models
# at all. Baking them in makes the image self-contained: one artifact to deploy,
# one thing to roll back, and the models that were tested are the models that
# run. The cost is that a retrain requires a rebuild, which is the right trade
# for a system retrained a handful of times.
#
# Note what is NOT copied: random_forest_regressor.joblib is 38.6 MB and
# xgboost_regressor.joblib 1.2 MB, and neither is ever loaded by the service.
# They are training outputs that produce the MAE figure reported in Chapter 4.
# Copying artifacts/ wholesale would quadruple the payload for files nothing
# runs.
#
# SINGLE WORKER — see the CMD at the bottom before changing it.

# =============================================================================
# Stage 1 — build the virtualenv
# =============================================================================
FROM python:3.13-slim AS builder

ENV PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# build-essential is needed to compile shap's C extension when no wheel matches
# the interpreter; it stays in this stage and never reaches the runtime image.
RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential \
    && rm -rf /var/lib/apt/lists/*

RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Dependencies before application code: this layer is the expensive one
# (TensorFlow alone is a few hundred MB to resolve and install) and it must not
# be invalidated by an edit to a router.
COPY ml-service/requirements-runtime.txt /tmp/requirements-runtime.txt
RUN pip install --upgrade pip \
    && pip install -r /tmp/requirements-runtime.txt

# =============================================================================
# Stage 2 — runtime
# =============================================================================
FROM python:3.13-slim

# libgomp1 is a hard runtime requirement of xgboost (OpenMP) and is not present
# in python:*-slim. Without it the image builds, starts, and raises
# "libgomp.so.1: cannot open shared object file" on the first joblib.load of
# xgboost.joblib -- i.e. on the first scored project, not at startup.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libgomp1 \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /opt/venv /opt/venv

ENV PATH="/opt/venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    # Keras 3 needs its backend named explicitly; left unset it probes for
    # torch/jax before settling on tensorflow, which logs confusing import
    # errors for backends that were never installed.
    KERAS_BACKEND=tensorflow \
    # TensorFlow's C++ logging is noisy on CPU-only hosts (AVX notices, absent
    # CUDA drivers). 2 = warnings and errors only, so the service's own
    # structured output stays readable.
    TF_CPP_MIN_LOG_LEVEL=2

# -----------------------------------------------------------------------------
# Application code. Copied as individual directories rather than `COPY . .` so
# that what the image contains is stated here and reviewable.
#
# models/ is NOT optional: inference/live_scoring.py, inference/explain.py and
# optimization_engine.py all `from train_trees import build_feature_matrix` to
# guarantee the scoring feature schema is byte-identical to the training one.
# An image without models/ starts cleanly and fails on the first scored
# project -- which is precisely why that import is called out here.
#
# data_pipeline/ is copied for its reference/ data (the LMB barangay point
# layer that common/geography.py loads for municipality centroids, and the
# project-type label tables), not for its ingest scripts.
# -----------------------------------------------------------------------------
WORKDIR /app/ml-service

COPY ml-service/main.py            ./main.py
COPY ml-service/optimization_engine.py ./optimization_engine.py
COPY ml-service/api/               ./api/
COPY ml-service/inference/         ./inference/
COPY ml-service/common/            ./common/
COPY ml-service/models/            ./models/
COPY ml-service/data_pipeline/     ./data_pipeline/

# -----------------------------------------------------------------------------
# Trained models — the runtime subset only. Enumerated, not globbed, so adding
# a new artifact to the scoring path is a visible change here rather than a
# silent dependency on whatever the build host happened to have lying around.
# -----------------------------------------------------------------------------
COPY ml-service/artifacts/tabular_feature_columns.json      ./artifacts/
COPY ml-service/artifacts/random_forest.joblib              ./artifacts/
COPY ml-service/artifacts/xgboost.joblib                    ./artifacts/
COPY ml-service/artifacts/lstm_model.keras                  ./artifacts/
COPY ml-service/artifacts/lstm_sequence_scaler.json         ./artifacts/
COPY ml-service/artifacts/meta_learner.joblib               ./artifacts/
COPY ml-service/artifacts/meta_learner_two.joblib           ./artifacts/

# Evaluation metrics, read by /api/v1/model-metrics for the Models tab. Not
# required to score; the endpoint 404s without them.
COPY ml-service/artifacts/tree_models_metrics.json          ./artifacts/
COPY ml-service/artifacts/lstm_model_metrics.json           ./artifacts/
COPY ml-service/artifacts/meta_learner_metrics.json         ./artifacts/
COPY ml-service/artifacts/regression_metrics.json           ./artifacts/
COPY ml-service/artifacts/meta_learner_test_predictions.csv ./artifacts/

# -----------------------------------------------------------------------------
# Prepared data. train.csv is here only as the SHAP background distribution,
# and test.csv only so an already-finished project reports "resolved" rather
# than "not_found" -- neither is scored.
# -----------------------------------------------------------------------------
COPY data/ready/inference.csv                      /app/data/ready/
COPY data/ready/train.csv                          /app/data/ready/
COPY data/ready/test.csv                           /app/data/ready/
COPY data/ready/scaler_params.json                 /app/data/ready/
COPY data/ready/lstm_inference_project_keys.json   /app/data/ready/
COPY data/ready/lstm_inference_sequences.npy       /app/data/ready/
COPY data/ready/lstm_inference_sequence_mask.npy   /app/data/ready/

# -----------------------------------------------------------------------------
# Results go to their own directory, and this is the line that makes a
# persistent volume safe.
#
# The service writes four files -- inspector_schedule.csv, its summary,
# optimizer_run_status.json and live_scores.json. They used to live in
# artifacts/ alongside the models, which cannot work deployed: the models are
# immutable and must come from the image on every start, while the results are
# mutable and worth keeping across restarts. Mounting a volume over artifacts/
# to get the second would permanently shadow the first, because Docker fills an
# empty named volume from the image once and never refreshes it -- so a rebuild
# with a retrained model would keep scoring with the OLD weights while
# reporting the new image's version.
#
# Pointing the writable set elsewhere (common/paths.py, ML_SERVICE_OUTPUT_DIR)
# means the volume mounts at /app/ml-service/outputs and artifacts/ is never
# covered.
# -----------------------------------------------------------------------------
ENV ML_SERVICE_OUTPUT_DIR=/app/ml-service/outputs

# Only outputs/ is chowned. artifacts/ stays root-owned and therefore read-only
# to the service, which is deliberate: the models are an immutable input, and
# the process that loads them has no business being able to overwrite them.
RUN useradd --create-home --uid 10001 maagap     && mkdir -p /app/ml-service/outputs     && chown -R maagap:maagap /app/ml-service/outputs

USER maagap

# Declared so `docker run` without an explicit mount still keeps results in a
# volume rather than the container's writable layer, and so the mount point is
# visible to anyone inspecting the image.
VOLUME ["/app/ml-service/outputs"]

EXPOSE 8000

# No curl or wget in python:*-slim, so the probe uses the interpreter that is
# certainly present. /health is deliberately the one unauthenticated route.
HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=3 \
    CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/health',timeout=4).status==200 else 1)"

# -----------------------------------------------------------------------------
# ONE WORKER. Do not raise this without first moving optimizer run state out of
# the filesystem.
#
# api/routers/optimizer.py tracks a run in artifacts/optimizer_run_status.json,
# read and written with no locking, and returns 409 when a run is already in
# progress. With a single worker that guard is correct. With two, each worker
# has its own view of the file, so two concurrent requests both see "idle" and
# both start a multi-minute CBC solve over the same artifacts -- and the second
# to finish overwrites the first's schedule. The in-process rate limiter in
# api/deps.py divides the same way: N workers permit N times the configured
# rate.
#
# This is R3 from the hardening pass, deferred deliberately because it only
# manifests once deployed. The fix is to move run state into Supabase; until
# then the single worker is load-bearing, not a default nobody revisited.
#
# Capacity is not the constraint it looks like: every caller is the Next.js
# server runtime, requests are either sub-second reads or one deliberate
# optimizer run, and uvicorn serves the reads concurrently within this worker.
# -----------------------------------------------------------------------------
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
