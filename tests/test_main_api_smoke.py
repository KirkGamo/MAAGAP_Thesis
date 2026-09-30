"""
Smoke tests for ml-service/main.py's FastAPI routes, plus the authentication
contract the S1/S2 hardening introduced.

Importing main.py (and its inference.live_scoring dependency) triggers no eager
network calls or heavy-library loads -- TensorFlow is imported lazily inside
score_lstm(), and Supabase is only touched inside _maybe_patch_supabase(),
itself only reached from a background task after a POST. TestClient(app) is
therefore safe here with no live credentials and no running Supabase project.

TWO LESSONS ARE BAKED INTO HOW THESE ASSERT.

1. ASSERT REQUIRED KEYS, NOT EXACT KEY SETS. The previous version asserted
   `set(body.keys()) == {...}` and sat red for several sessions -- not because
   anything broke, but because /api/v1/latest-schedule began returning
   `generated_at` and /api/v1/model-metrics began returning `regression`. Both
   were purely additive, backward-compatible changes. A smoke test that fails
   on additive change trains everyone to ignore it, which is worse than having
   no test. These assert that the contract's keys are PRESENT.

2. AUTHENTICATION IS PART OF THE CONTRACT. Every route except /health now
   requires the shared secret, so each is asserted both ways: rejected without
   it, served with it. The previous suite called these routes unauthenticated
   and passed, which is exactly what it looked like when they genuinely were.
"""

import pytest
from fastapi.testclient import TestClient

import main
from main import app

client = TestClient(app)

SECRET = main.WEBHOOK_SECRET
AUTH = {"X-Webhook-Secret": SECRET} if SECRET else {}

# Every route that must reject an unauthenticated caller.
GUARDED_GET_ROUTES = [
    "/api/v1/model-metrics",
    "/api/v1/latest-schedule",
    "/api/v1/optimizer-status",
    "/api/v1/live-score/SOME_KEY",
]


# ---------------------------------------------------------------------------
# Liveness
# ---------------------------------------------------------------------------

def test_health_endpoint_is_always_ok_and_needs_no_secret():
    """/health must stay open: it is what a container orchestrator polls, and
    it reveals nothing beyond the fact that the process is up."""
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


# ---------------------------------------------------------------------------
# Authentication contract (S1/S2)
# ---------------------------------------------------------------------------

@pytest.mark.skipif(not SECRET, reason="no webhook secret configured in this environment")
@pytest.mark.parametrize("route", GUARDED_GET_ROUTES)
def test_guarded_get_routes_reject_an_unauthenticated_caller(route: str):
    """S2. latest-schedule is the one that matters most: it returns which
    inspector visits which project on which day -- the whereabouts of named
    provincial staff."""
    assert client.get(route).status_code == 401


@pytest.mark.skipif(not SECRET, reason="no webhook secret configured in this environment")
@pytest.mark.parametrize(
    "route",
    [
        "/api/v1/update-monitoring",
        "/api/v1/run-optimizer",
        # The webhook was NOT covered here originally, and that gap hid a real
        # bug: it delegates to update_monitoring(), which later grew a `request`
        # parameter, and the positional call bound the secret to it. The route
        # kept returning 202 to callers whose secret was never actually checked.
        "/webhooks/monitoring-report",
    ],
)
def test_guarded_post_routes_reject_an_unauthenticated_caller(route: str):
    payload = {"project_key": "NOT_A_REAL_KEY", "status_observed": "On-going"}
    assert client.post(route, json=payload).status_code == 401


@pytest.mark.skipif(not SECRET, reason="no webhook secret configured in this environment")
def test_the_webhook_alias_accepts_a_correct_secret():
    """The other direction: the delegation must still WORK, not merely reject.
    A fix that made the alias reject everything would pass the test above."""
    payload = {"project_key": "NOT_A_REAL_KEY", "status_observed": "On-going"}
    response = client.post(
        "/webhooks/monitoring-report", json=payload, headers={"X-Webhook-Secret": SECRET}
    )
    assert response.status_code == 202


@pytest.mark.skipif(not SECRET, reason="no webhook secret configured in this environment")
def test_a_wrong_secret_is_rejected():
    assert client.get(
        "/api/v1/model-metrics", headers={"X-Webhook-Secret": "definitely-not-it"}
    ).status_code == 401


def test_the_guard_cannot_be_disabled_by_an_absent_secret():
    """S1 regression test. The original guard read

        if WEBHOOK_SECRET and x != WEBHOOK_SECRET:

    so an unset env var short-circuited it and every guarded route became
    unauthenticated -- silently, with the service otherwise behaving normally.
    The module now refuses to import in that state unless ALLOW_UNAUTHENTICATED
    is explicitly set, so this asserts the two are never both false."""
    assert main.WEBHOOK_SECRET or main.ALLOW_UNAUTHENTICATED, (
        "main.py imported with neither a secret nor an explicit opt-in — "
        "the fail-open guard has been reintroduced"
    )


# ---------------------------------------------------------------------------
# Route contracts, asserted tolerantly (see lesson 1)
# ---------------------------------------------------------------------------

def test_model_metrics_returns_its_contract_keys_or_404_if_untrained():
    response = client.get("/api/v1/model-metrics", headers=AUTH)
    assert response.status_code in (200, 404)
    if response.status_code == 200:
        body = response.json()
        assert {"tree_models", "lstm", "meta_learner", "confusion_matrix"} <= set(body)


def test_latest_schedule_returns_its_contract_keys_or_404_if_undeployed():
    response = client.get("/api/v1/latest-schedule", headers=AUTH)
    assert response.status_code in (200, 404)
    if response.status_code == 200:
        body = response.json()
        assert {"rows", "summary"} <= set(body)
        assert isinstance(body["rows"], list)


def test_live_score_404s_for_an_unknown_project_key():
    """A key that was never re-scored must 404, not return an empty or zeroed
    body that could be mistaken for a real score of zero risk."""
    response = client.get(
        "/api/v1/live-score/THIS_KEY_SHOULD_NOT_EXIST_XYZ", headers=AUTH
    )
    assert response.status_code == 404


def test_openapi_schema_is_generated_without_error():
    """A cheap, broad check that every route's request/response models are
    still valid -- a bad type annotation fails here rather than at /docs."""
    response = client.get("/openapi.json")
    assert response.status_code == 200
    schema = response.json()
    assert "/health" in schema["paths"]
    assert "/api/v1/update-monitoring" in schema["paths"]
