"""
Tests for ml-service/common/settings.py (B2).

The rules here are the generalisation of S1. That bug was not really an
authentication bug — it was configuration read without validation, where a
missing value degraded into permissive behaviour instead of a refusal. These
assert the refusals, because a settings object that quietly accepts nonsense
is no better than scattered os.environ reads.
"""

from __future__ import annotations

import os
from contextlib import contextmanager

import pytest

from common.settings import MLServiceSettings


@contextmanager
def env(**overrides):
    """Temporarily set or unset environment variables."""
    saved = {k: os.environ.get(k) for k in overrides}
    try:
        for key, value in overrides.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
        yield
    finally:
        for key, value in saved.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value


BASE = {
    "ML_SERVICE_WEBHOOK_SECRET": "a-real-looking-secret-value",
    "ALLOW_UNAUTHENTICATED": None,
    "ML_SERVICE_RATE_LIMIT_PER_MINUTE": None,
    "ML_SERVICE_ALLOWED_ORIGINS": None,
}


# ---------------------------------------------------------------------------
# The S1 rule
# ---------------------------------------------------------------------------

def test_a_missing_secret_refuses_to_build():
    """The whole point. An absent secret must never mean 'authentication off'."""
    with env(**{**BASE, "ML_SERVICE_WEBHOOK_SECRET": None}):
        with pytest.raises(RuntimeError, match="ML_SERVICE_WEBHOOK_SECRET"):
            MLServiceSettings.from_env()


@pytest.mark.parametrize("blank", ["", "   ", "\t"])
def test_a_blank_secret_is_treated_as_missing(blank: str):
    """A variable set to whitespace is the shape a broken deploy template
    produces, and it must not count as configured."""
    with env(**{**BASE, "ML_SERVICE_WEBHOOK_SECRET": blank}):
        with pytest.raises(RuntimeError):
            MLServiceSettings.from_env()


@pytest.mark.parametrize("placeholder", ["changeme", "CHANGE-ME", "secret", "todo", "xxx"])
def test_a_placeholder_secret_is_rejected(placeholder: str):
    """A secret left at its example value is not a secret. These are the
    strings that survive a copied .env.example into production."""
    with env(**{**BASE, "ML_SERVICE_WEBHOOK_SECRET": placeholder}):
        with pytest.raises(RuntimeError, match="placeholder"):
            MLServiceSettings.from_env()


def test_running_unauthenticated_requires_an_explicit_opt_in():
    with env(**{**BASE, "ML_SERVICE_WEBHOOK_SECRET": None, "ALLOW_UNAUTHENTICATED": "1"}):
        settings = MLServiceSettings.from_env()
        assert settings.is_unauthenticated is True


@pytest.mark.parametrize("truthy", ["1", "true", "TRUE", "yes", "on"])
def test_opt_in_accepts_the_usual_truthy_spellings(truthy: str):
    with env(**{**BASE, "ML_SERVICE_WEBHOOK_SECRET": None, "ALLOW_UNAUTHENTICATED": truthy}):
        assert MLServiceSettings.from_env().allow_unauthenticated is True


@pytest.mark.parametrize("falsy", ["0", "false", "no", "", "maybe"])
def test_anything_else_is_not_an_opt_in(falsy: str):
    """A typo in the opt-in must fail closed, not open."""
    with env(**{**BASE, "ML_SERVICE_WEBHOOK_SECRET": None, "ALLOW_UNAUTHENTICATED": falsy}):
        with pytest.raises(RuntimeError):
            MLServiceSettings.from_env()


def test_a_configured_secret_is_not_unauthenticated_even_with_the_opt_in():
    """Opting in while a secret exists must still authenticate — otherwise a
    stale ALLOW_UNAUTHENTICATED in a deploy config would disable a working
    guard."""
    with env(**{**BASE, "ALLOW_UNAUTHENTICATED": "1"}):
        settings = MLServiceSettings.from_env()
        assert settings.allow_unauthenticated is True
        assert settings.is_unauthenticated is False


# ---------------------------------------------------------------------------
# Other validated values
# ---------------------------------------------------------------------------

def test_rate_limit_defaults_when_unset():
    with env(**BASE):
        assert MLServiceSettings.from_env().rate_limit_per_minute == 10


def test_rate_limit_rejects_a_non_number():
    with env(**{**BASE, "ML_SERVICE_RATE_LIMIT_PER_MINUTE": "ten"}):
        with pytest.raises(RuntimeError, match="whole number"):
            MLServiceSettings.from_env()


def test_rate_limit_rejects_a_negative_value():
    with env(**{**BASE, "ML_SERVICE_RATE_LIMIT_PER_MINUTE": "-5"}):
        with pytest.raises(RuntimeError):
            MLServiceSettings.from_env()


def test_rate_limit_zero_is_allowed_as_an_explicit_disable():
    with env(**{**BASE, "ML_SERVICE_RATE_LIMIT_PER_MINUTE": "0"}):
        assert MLServiceSettings.from_env().rate_limit_per_minute == 0


def test_origins_parse_and_strip():
    with env(**{**BASE, "ML_SERVICE_ALLOWED_ORIGINS": " https://a.example , https://b.example "}):
        assert MLServiceSettings.from_env().allowed_origins == [
            "https://a.example",
            "https://b.example",
        ]


def test_origins_default_to_empty():
    """Empty is the correct default: the Next.js frontend calls this service
    from the server side, where CORS does not apply."""
    with env(**BASE):
        assert MLServiceSettings.from_env().allowed_origins == []


def test_supabase_write_capability_is_reported_not_assumed():
    with env(**{**BASE, "SUPABASE_URL": None, "SUPABASE_SERVICE_ROLE_KEY": None}):
        assert MLServiceSettings.from_env().can_write_to_supabase is False
    with env(**{**BASE, "SUPABASE_URL": "https://x.supabase.co",
                "SUPABASE_SERVICE_ROLE_KEY": "k"}):
        assert MLServiceSettings.from_env().can_write_to_supabase is True


def test_startup_summary_does_not_raise():
    """It runs at import on every boot; an exception there takes the service
    down for a logging concern."""
    with env(**BASE):
        MLServiceSettings.from_env().log_startup_summary()
