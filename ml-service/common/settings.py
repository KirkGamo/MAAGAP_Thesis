"""
MAAGAP — validated ML-service configuration (B2)
================================================================================
One place that states what this service needs to run, validated once at import
rather than read ad hoc wherever a value happens to be wanted.

WHY THIS EXISTS
------------------------------------------------------------------------------
Configuration was read directly from os.environ in several modules, each with
its own fallback behaviour. Nothing said what the service required, and nothing
checked. That is the root of S1, not a stylistic complaint: the webhook guard
read

    if WEBHOOK_SECRET and x_webhook_secret != WEBHOOK_SECRET:

so an unset variable silently disabled authentication on every guarded route.
The specific hole is now closed, but the shape that produced it -- a missing
value degrading into permissive behaviour rather than a refusal -- is a
property of reading configuration without validating it.

A settings object generalises the fix: every value is declared with a type and
a rule, the service refuses to start when a required one is absent or invalid,
and the failure names the variable and how to set it.

DELIBERATELY NOT pydantic-settings. Six variables do not justify a dependency,
and this keeps `_load_env_file()`'s existing semantics -- it populates only
variables not already set, so a container's own environment always wins over a
committed .env. That precedence is load-bearing for deployment and is easy to
lose by switching loaders.
"""

from __future__ import annotations

import logging
import os
from functools import lru_cache
from pathlib import Path
from typing import Optional

from pydantic import BaseModel, Field, ValidationError, field_validator, model_validator

logger = logging.getLogger("maagap.settings")

TRUTHY = {"1", "true", "yes", "on"}


class MLServiceSettings(BaseModel):
    """Everything ml-service reads from the environment, with its rules."""

    webhook_secret: str = ""
    allow_unauthenticated: bool = False

    supabase_url: Optional[str] = None
    supabase_service_role_key: Optional[str] = None

    rate_limit_per_minute: int = Field(default=10, ge=0)
    allowed_origins: list[str] = Field(default_factory=list)

    @field_validator("webhook_secret")
    @classmethod
    def _reject_placeholder_secrets(cls, value: str) -> str:
        """A secret left at an example value is not a secret. These are the
        strings that appear in .env.example and in copied deploy configs."""
        placeholders = {"changeme", "change-me", "secret", "your-secret-here", "xxx", "todo"}
        if value and value.strip().lower() in placeholders:
            raise ValueError(
                f"ML_SERVICE_WEBHOOK_SECRET is set to the placeholder {value!r}. "
                "Generate a real value, e.g. `python -c \"import secrets; "
                'print(secrets.token_urlsafe(32))"`.'
            )
        return value

    @model_validator(mode="after")
    def _require_a_secret_unless_explicitly_waived(self) -> "MLServiceSettings":
        """S1, stated once as a rule rather than repeated as a check.

        An absent secret must never mean 'authentication off'. It means the
        service does not start, unless someone has explicitly asked for an
        unauthenticated local instance.
        """
        if not self.webhook_secret and not self.allow_unauthenticated:
            raise ValueError(
                "ML_SERVICE_WEBHOOK_SECRET is not set. This service will not start "
                "without it, because an absent secret would leave "
                "/api/v1/update-monitoring (which mutates risk tiers) and "
                "/api/v1/run-optimizer (which spends minutes of CPU) open to anyone "
                "who can reach the port.\n\n"
                "Fix: set ML_SERVICE_WEBHOOK_SECRET in ml-service/.env "
                "(see .env.example).\n"
                "For local development without a secret, set ALLOW_UNAUTHENTICATED=1 "
                "explicitly -- never in any environment reachable from outside "
                "localhost."
            )
        return self

    # -- derived properties ------------------------------------------------

    @property
    def is_unauthenticated(self) -> bool:
        """True only in the explicitly-waived local mode."""
        return self.allow_unauthenticated and not self.webhook_secret

    @property
    def can_write_to_supabase(self) -> bool:
        return bool(self.supabase_url and self.supabase_service_role_key)

    @classmethod
    def from_env(cls) -> "MLServiceSettings":
        """Build from os.environ, raising a RuntimeError that names the problem
        rather than a pydantic traceback a deployer has to decode."""
        raw_limit = os.environ.get("ML_SERVICE_RATE_LIMIT_PER_MINUTE", "10").strip()
        try:
            limit = int(raw_limit) if raw_limit else 10
        except ValueError:
            raise RuntimeError(
                f"ML_SERVICE_RATE_LIMIT_PER_MINUTE must be a whole number, got {raw_limit!r}."
            ) from None

        try:
            return cls(
                webhook_secret=(os.environ.get("ML_SERVICE_WEBHOOK_SECRET") or "").strip(),
                allow_unauthenticated=(
                    os.environ.get("ALLOW_UNAUTHENTICATED", "").strip().lower() in TRUTHY
                ),
                supabase_url=os.environ.get("SUPABASE_URL") or None,
                supabase_service_role_key=os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or None,
                rate_limit_per_minute=limit,
                allowed_origins=[
                    o.strip()
                    for o in os.environ.get("ML_SERVICE_ALLOWED_ORIGINS", "").split(",")
                    if o.strip()
                ],
            )
        except ValidationError as exc:
            messages = "\n".join(f"  - {e['msg']}" for e in exc.errors())
            raise RuntimeError(
                f"ml-service configuration is invalid:\n{messages}"
            ) from None

    def log_startup_summary(self) -> None:
        """One line per thing a deployer would want confirmed, and a loud line
        for each thing that silently degrades behaviour."""
        if self.is_unauthenticated:
            logger.error(
                "RUNNING WITHOUT AUTHENTICATION. ALLOW_UNAUTHENTICATED is set and no "
                "webhook secret is configured, so guarded endpoints accept any caller. "
                "This is for local development only."
            )
        if not self.can_write_to_supabase:
            logger.warning(
                "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set — this service can "
                "score, but nothing it computes will be written back. Live risk-tier "
                "updates and monitoring-report re-score outcomes will both silently "
                "no-op. Fix: copy ml-service/.env.example to ml-service/.env and fill it "
                "in (values are in frontend/.env.local; note SUPABASE_URL is called "
                "NEXT_PUBLIC_SUPABASE_URL there)."
            )
        if self.rate_limit_per_minute == 0:
            logger.warning(
                "Rate limiting is DISABLED (ML_SERVICE_RATE_LIMIT_PER_MINUTE=0). The "
                "optimizer route spends minutes of CPU per call."
            )
        logger.info(
            "Config: auth=%s supabase_writes=%s rate_limit=%s/min cors_origins=%d",
            "off" if self.is_unauthenticated else "on",
            "on" if self.can_write_to_supabase else "off",
            self.rate_limit_per_minute or "disabled",
            len(self.allowed_origins),
        )


# ---------------------------------------------------------------------------
# .env loading and the single shared instance.
#
# This lives here rather than in main.py because api/deps.py and the routers
# need settings too, and they must be importable without main.py having run
# first -- otherwise the HTTP layer can only be imported through the
# application entry point, which makes the routers untestable in isolation.
#
# The precedence rule is deliberate and load-bearing: variables already present
# in the environment are NEVER overwritten, so a container's own configuration
# always wins over a committed .env file.
# ---------------------------------------------------------------------------

ENV_FILE = Path(__file__).resolve().parent.parent / ".env"


def load_env_file(path: Path = ENV_FILE) -> int:
    """Populate os.environ from a KEY=VALUE file, without overriding anything
    already set. Returns how many variables were loaded."""
    if not path.exists():
        return 0
    loaded = 0
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key, value = key.strip(), value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value
            loaded += 1
    if loaded:
        logger.info("Loaded %d environment variable(s) from %s", loaded, path)
    return loaded


@lru_cache(maxsize=1)
def get_settings() -> MLServiceSettings:
    """The one settings instance, built on first use.

    Cached so that importing main.py and api/deps.py in either order yields the
    same object and validates exactly once.
    """
    load_env_file()
    return MLServiceSettings.from_env()
