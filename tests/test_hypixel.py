"""Tests for the Hypixel client and its rate limiter."""

from __future__ import annotations

import asyncio

import aiohttp
import pytest

from round105.errors import (
    InvalidApiKey,
    PlayerNeverLoggedIn,
    RateLimited,
    UpstreamUnavailable,
)
from round105.hypixel import HypixelClient, RateLimiter

from .fakes import FakeResponse, FakeSession

UUID = "b3f1a2c47d8e4f0a9b6c5d4e3f2a1b09"


def make_client(responses, **kwargs) -> tuple[HypixelClient, FakeSession]:
    session = FakeSession(responses)
    client = HypixelClient(session, api_key="test-key", **kwargs)  # type: ignore[arg-type]
    return client, session


async def test_successful_fetch_returns_the_player(sample_player):
    client, session = make_client(
        [FakeResponse(200, {"success": True, "player": sample_player})]
    )

    player = await client.fetch_player(UUID, "RoundRunner")

    assert player["displayname"] == "RoundRunner"
    assert session.last_params() == {"uuid": UUID}
    assert session.last_headers()["API-Key"] == "test-key"


@pytest.mark.parametrize("status", [401, 403])
async def test_rejected_key_raises(status):
    client, _ = make_client([FakeResponse(status, {"success": False})])

    with pytest.raises(InvalidApiKey):
        await client.fetch_player(UUID)


async def test_key_error_in_body_raises_invalid_key():
    client, _ = make_client(
        [FakeResponse(200, {"success": False, "cause": "Invalid API key"})]
    )

    with pytest.raises(InvalidApiKey):
        await client.fetch_player(UUID)


async def test_http_429_uses_retry_after():
    client, _ = make_client(
        [FakeResponse(429, {"success": False}, {"Retry-After": "37"})]
    )

    with pytest.raises(RateLimited) as excinfo:
        await client.fetch_player(UUID)
    assert excinfo.value.retry_after == 37


async def test_429_without_header_falls_back_to_a_default():
    client, _ = make_client([FakeResponse(429, {"success": False})])

    with pytest.raises(RateLimited) as excinfo:
        await client.fetch_player(UUID)
    assert excinfo.value.retry_after == 60


async def test_throttle_flag_in_body_raises_rate_limited():
    client, _ = make_client(
        [FakeResponse(200, {"success": False, "throttle": True, "cause": "throttled"})]
    )

    with pytest.raises(RateLimited):
        await client.fetch_player(UUID)


async def test_null_player_means_never_logged_in():
    client, _ = make_client([FakeResponse(200, {"success": True, "player": None})])

    with pytest.raises(PlayerNeverLoggedIn):
        await client.fetch_player(UUID, "Ghost")


async def test_malformed_uuid_response_means_never_logged_in():
    client, _ = make_client([FakeResponse(422, {"success": False})])

    with pytest.raises(PlayerNeverLoggedIn):
        await client.fetch_player("nonsense")


@pytest.mark.parametrize("status", [500, 502, 503])
async def test_server_errors_are_upstream_failures(status):
    client, _ = make_client([FakeResponse(status, None)])

    with pytest.raises(UpstreamUnavailable):
        await client.fetch_player(UUID)


async def test_unexpected_body_is_an_upstream_failure():
    client, _ = make_client([FakeResponse(200, "not a dict")])

    with pytest.raises(UpstreamUnavailable):
        await client.fetch_player(UUID)


async def test_connection_error_is_an_upstream_failure():
    client, _ = make_client([aiohttp.ClientConnectionError("boom")])

    with pytest.raises(UpstreamUnavailable) as excinfo:
        await client.fetch_player(UUID)
    assert "Hypixel" in str(excinfo.value)


async def test_timeout_is_an_upstream_failure():
    client, _ = make_client([TimeoutError()])

    with pytest.raises(UpstreamUnavailable):
        await client.fetch_player(UUID)


async def test_limiter_records_the_reported_budget(sample_player):
    client, _ = make_client(
        [
            FakeResponse(
                200,
                {"success": True, "player": sample_player},
                {"RateLimit-Remaining": "42", "RateLimit-Reset": "120"},
            )
        ]
    )

    await client.fetch_player(UUID)

    assert client.limiter.remaining == 42


async def test_limiter_counts_down_between_requests(sample_player):
    responses = [
        FakeResponse(
            200,
            {"success": True, "player": sample_player},
            {"RateLimit-Remaining": "10", "RateLimit-Reset": "60"},
        ),
        FakeResponse(200, {"success": True, "player": sample_player}),
    ]
    client, _ = make_client(responses)

    await client.fetch_player(UUID)
    assert client.limiter.remaining == 10
    # The second request has no headers to refresh the budget, so the limiter
    # relies on its own decrement.
    await client.fetch_player(UUID)
    assert client.limiter.remaining == 9


async def test_limiter_waits_when_the_budget_is_spent(monkeypatch):
    limiter = RateLimiter(reserved=1)
    limiter.update({"RateLimit-Remaining": "1", "RateLimit-Reset": "5"})

    slept: list[float] = []

    async def fake_sleep(seconds: float) -> None:
        slept.append(seconds)

    monkeypatch.setattr(asyncio, "sleep", fake_sleep)
    await limiter.acquire()

    assert slept and slept[0] == pytest.approx(5, abs=1)
    # After waiting, the limiter forgets the old budget and trusts the next
    # response to refresh it.
    assert limiter.remaining is None


async def test_limiter_does_not_wait_before_the_first_response():
    limiter = RateLimiter()
    await limiter.acquire()  # must not block
    assert limiter.remaining is None


async def test_limiter_ignores_malformed_headers():
    limiter = RateLimiter()
    limiter.update({"RateLimit-Remaining": "lots", "RateLimit-Reset": ""})
    assert limiter.remaining is None
