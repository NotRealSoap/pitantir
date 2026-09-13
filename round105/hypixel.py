"""Hypixel API client.

Wraps the single endpoint this bot needs (``/v2/player``) with rate limit
handling. Hypixel allots a fixed number of requests per five minute window per
key and reports the remaining budget on every response, so the client tracks
those headers and waits for the window to roll over rather than earning a 429.
"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Any, Mapping

import aiohttp

from .errors import InvalidApiKey, PlayerNeverLoggedIn, RateLimited, UpstreamUnavailable

log = logging.getLogger(__name__)

PLAYER_URL = "https://api.hypixel.net/v2/player"

#: Leave a little of the budget unspent so a burst of commands cannot wedge the
#: key into a hard 429, which carries a longer penalty than waiting locally.
RESERVED_REQUESTS = 2


class RateLimiter:
    """Tracks the API budget reported by Hypixel's rate limit headers.

    Hypixel's limit is per key rather than per connection, so all callers share
    one limiter guarded by a lock; requests queue instead of racing the budget.
    """

    def __init__(self, reserved: int = RESERVED_REQUESTS) -> None:
        self._reserved = reserved
        self._lock = asyncio.Lock()
        self._remaining: int | None = None
        self._reset_at: float = 0.0

    async def acquire(self) -> None:
        """Wait until it is safe to issue another request."""

        async with self._lock:
            if self._remaining is None:
                return
            if self._remaining > self._reserved:
                self._remaining -= 1
                return

            delay = max(self._reset_at - time.monotonic(), 0.0)
            if delay > 0:
                log.info("Hypixel budget exhausted; waiting %.1fs for reset", delay)
                await asyncio.sleep(delay)
            # The window has rolled over; the next response refreshes the budget.
            self._remaining = None

    def update(self, headers: Mapping[str, str]) -> None:
        """Record the budget advertised by a response."""

        remaining = _header_int(headers, "RateLimit-Remaining")
        reset = _header_int(headers, "RateLimit-Reset")
        if remaining is not None:
            self._remaining = remaining
        if reset is not None:
            self._reset_at = time.monotonic() + reset

    @property
    def remaining(self) -> int | None:
        return self._remaining


def _header_int(headers: Mapping[str, str], name: str) -> int | None:
    raw = headers.get(name)
    if raw is None:
        return None
    try:
        return int(raw)
    except (TypeError, ValueError):
        return None


class HypixelClient:
    """Fetches player data from the Hypixel API."""

    def __init__(
        self,
        session: aiohttp.ClientSession,
        api_key: str,
        timeout_seconds: int = 10,
        limiter: RateLimiter | None = None,
    ) -> None:
        self._session = session
        self._api_key = api_key
        self._timeout = aiohttp.ClientTimeout(total=timeout_seconds)
        self._limiter = limiter or RateLimiter()

    @property
    def limiter(self) -> RateLimiter:
        return self._limiter

    async def fetch_player(self, uuid: str, username: str = "") -> dict[str, Any]:
        """Fetch the raw ``player`` object for ``uuid``.

        ``username`` is only used to build readable error messages. Raises
        :class:`PlayerNeverLoggedIn` when Hypixel has no record of the account,
        :class:`InvalidApiKey`, :class:`RateLimited`, or
        :class:`UpstreamUnavailable`.
        """

        await self._limiter.acquire()

        label = username or uuid
        try:
            async with self._session.get(
                PLAYER_URL,
                params={"uuid": uuid},
                headers={"API-Key": self._api_key},
                timeout=self._timeout,
            ) as response:
                self._limiter.update(response.headers)

                if response.status in (401, 403):
                    raise InvalidApiKey()
                if response.status == 429:
                    retry_after = _header_int(response.headers, "Retry-After") or 60
                    raise RateLimited(float(retry_after))
                if response.status == 422:
                    # Malformed uuid; treat as an unknown player.
                    raise PlayerNeverLoggedIn(label)
                if response.status >= 500:
                    raise UpstreamUnavailable("Hypixel", f"HTTP {response.status}")
                if response.status >= 400:
                    raise UpstreamUnavailable("Hypixel", f"HTTP {response.status}")

                payload = await response.json(content_type=None)
        except aiohttp.ClientError as exc:
            log.warning("Hypixel request failed for %s: %s", label, exc)
            raise UpstreamUnavailable("Hypixel", "connection error") from exc
        except TimeoutError as exc:
            log.warning("Hypixel request timed out for %s", label)
            raise UpstreamUnavailable("Hypixel", "timed out") from exc

        if not isinstance(payload, dict):
            raise UpstreamUnavailable("Hypixel", "unexpected response")

        if not payload.get("success", False):
            cause = str(payload.get("cause", "")).lower()
            if "key" in cause:
                raise InvalidApiKey()
            if payload.get("throttle"):
                raise RateLimited(60.0)
            raise UpstreamUnavailable("Hypixel", cause or "request rejected")

        player = payload.get("player")
        if not isinstance(player, dict) or not player:
            # A successful response with a null player means the account exists
            # in Mojang's records but has never joined Hypixel.
            raise PlayerNeverLoggedIn(label)

        return player
