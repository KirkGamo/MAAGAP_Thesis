"""
Phase 14: basic smoke test for the ml-service/main.py FastAPI endpoints.

Importing main.py (and its inference.live_scoring dependency) does not
trigger any eager network calls or heavy-library loads -- TensorFlow is
imported lazily inside score_lstm(), and Supabase is only touched inside
_maybe_patch_supabase(), itself only reached from a background task after
a POST. So TestClient(app) is safe to exercise here with no live
credentials, no running Supabase project, and no trained-model artifacts
required for the routes this file actually asserts against.

Scope, deliberately kept narrow for a "smoke" test:
  * /health -- asserted strictly (no external state, must always be ok).
  * /api/v1/model-metrics and /api/v1/latest-schedule -- asserted
    TOLERANTLY. This repo's artifacts/ directory already has real training
    output on disk, so these currently return 200 with real data. But the
    contract these routes hold (per main.py's own docstrings) is "200 with
    real content if artifacts exist, else a 404 saying so" -- both are
    valid, non-broken behavior, so this test accepts either rather than
    hard-coding today's artifact state into a supposedly basic smoke test.
  * POST routes are NOT exercised here: they require background-task
    completion and (for the Supabase-patch path) network/service-role
    credentials this test environment doesn't have -- that's more of an
    integration-test concern than a "does the app boot and route" smoke
    test.
"""

from fastapi.testclient import TestClient

from main import app

client = TestClient(app)


def test_health_endpoint_is_always_ok():
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_model_metrics_returns_200_with_expected_shape_or_404_if_untrained():
    response = client.get("/api/v1/model-metrics")
    assert response.status_code in (200, 404)
    if response.status_code == 200:
        body = response.json()
        assert set(body.keys()) == {"tree_models", "lstm", "meta_learner", "confusion_matrix"}


def test_latest_schedule_returns_200_with_expected_shape_or_404_if_undeployed():
    response = client.get("/api/v1/latest-schedule")
    assert response.status_code in (200, 404)
    if response.status_code == 200:
        body = response.json()
        assert set(body.keys()) == {"rows", "summary"}
        assert isinstance(body["rows"], list)


def test_live_score_404s_for_an_unknown_project_key():
    """A project_key that was never re-scored must 404, not silently
    return an empty/zeroed body that could be mistaken for a real score."""
    response = client.get("/api/v1/live-score/THIS_KEY_SHOULD_NOT_EXIST_XYZ")
    assert response.status_code == 404


def test_openapi_schema_is_generated_without_error():
    """A cheap, broad check that every route's request/response models are
    still valid Pydantic models -- if a future edit breaks a schema
    (e.g. a bad type annotation), this fails fast instead of only
    surfacing at /docs load time."""
    response = client.get("/openapi.json")
    assert response.status_code == 200
    schema = response.json()
    assert "/health" in schema["paths"]
    assert "/api/v1/update-monitoring" in schema["paths"]
