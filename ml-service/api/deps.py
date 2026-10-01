"""
Shared request dependencies: authentication and rate limiting (B1).

These live here rather than in main.py because every router needs them and none
owns them. Keeping them in one module also means the S1 rule -- that an absent
secret is a refusal to start, never authentication silently off -- is enforced
at exactly one place regardless of how many routes exist.
"""

from __future__ import annotations

import hmac
import logging
import time
from collections import defaultdict
from typing import Optional

from fastapi import HTTPException, Request

from common.settings import get_settings

logger = logging.getLogger("maagap.api.deps")

# The one shared instance; see common/settings.py for why it lives there.
settings = get_settings()

WEBHOOK_SECRET = settings.webhook_secret
ALLOW_UNAUTHENTICATED = settings.allow_unauthenticated

RATE_LIMIT_WINDOW_SECONDS = 60.0
RATE_LIMIT_MAX_REQUESTS = settings.rate_limit_per_minute

_rate_buckets: dict[str, list[float]] = defaultdict(list)

# A bucket is only pruned when THAT client calls again, so a caller that
# appears once and never returns keeps its entry forever. On a public service
# that is an unbounded dict keyed by every IP that has ever touched it --
# scanners included. Measured: 5,000 one-time clients leave 5,000 permanent
# entries. Small individually, never reclaimed.
#
# A periodic sweep bounds it. Done on a call counter rather than a timer so it
# needs no background task and costs nothing when the service is idle.
_SWEEP_EVERY_N_REQUESTS = 500
_requests_since_sweep = 0


def _sweep_rate_buckets(now: float, window: float) -> None:
    """Drop buckets whose every timestamp has aged out."""
    cutoff = now - window
    stale = [key for key, hits in _rate_buckets.items() if not hits or hits[-1] <= cutoff]
    for key in stale:
        del _rate_buckets[key]
    if stale:
        logger.debug("Rate limiter swept %d stale client bucket(s).", len(stale))


def _client_key(request: Optional[Request]) -> str:
    if request is None:
        return "unknown"
    forwarded = request.headers.get("x-forwarded-for", "")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def _check_rate_limit(request: Optional[Request]) -> None:
    """Sliding-window limit per client. Raises 429 when exceeded."""
    if RATE_LIMIT_MAX_REQUESTS <= 0:
        return
    global _requests_since_sweep

    key = _client_key(request)
    now = time.monotonic()

    _requests_since_sweep += 1
    if _requests_since_sweep >= _SWEEP_EVERY_N_REQUESTS:
        _requests_since_sweep = 0
        _sweep_rate_buckets(now, RATE_LIMIT_WINDOW_SECONDS)
    bucket = _rate_buckets[key]
    cutoff = now - RATE_LIMIT_WINDOW_SECONDS
    bucket[:] = [t for t in bucket if t > cutoff]
    if len(bucket) >= RATE_LIMIT_MAX_REQUESTS:
        retry_after = int(max(1, RATE_LIMIT_WINDOW_SECONDS - (now - bucket[0])))
        logger.warning("Rate limit hit by %s on an expensive route.", key)
        raise HTTPException(
            status_code=429,
            detail=f"Too many requests. Retry in {retry_after}s.",
            headers={"Retry-After": str(retry_after)},
        )
    bucket.append(now)


def _check_webhook_secret(x_webhook_secret: Optional[str]) -> None:
    """
    Authenticate a guarded request.

    Two deliberate properties, both absent from the previous version:

    * It fails CLOSED. A missing secret cannot disable the check, because the
      service refuses to start in that state (see ALLOW_UNAUTHENTICATED above).
    * It compares in constant time. A plain `!=` short-circuits on the first
      differing byte, leaking the secret's length and prefix through response
      timing -- cheap to avoid, and this system's own thesis claims public
      sector accountability.
    """
    if settings.is_unauthenticated:
        logger.warning(
            "Unauthenticated request permitted by ALLOW_UNAUTHENTICATED — "
            "local development mode."
        )
        return
    if not x_webhook_secret or not hmac.compare_digest(x_webhook_secret, WEBHOOK_SECRET):
        raise HTTPException(status_code=401, detail="Invalid or missing X-Webhook-Secret header.")


