"""Tests for username to UUID resolution."""

from __future__ import annotations

import aiohttp
import pytest

from round105.errors import PlayerNotFound, UpstreamUnavailable
from round105.mojang import MojangClient, dash_uuid, is_valid_username

from .fakes import FakeResponse, FakeSession

UUID = "b3f1a2c47d8e4f0a9b6c5d4e3f2a1b09"


def make_client(responses) -> tuple[MojangClient, FakeSession]:
    session = FakeSession(responses)
    return MojangClient(session), session  # type: ignore[arg-type]


async def test_resolves_a_username():
    client, session = make_client(
        [FakeResponse(200, {"id": UUID, "name": "RoundRunner"})]
    )

    profile = await client.fetch_profile("roundrunner")

    assert profile.uuid == UUID
    assert profile.name == "RoundRunner"
    assert "roundrunner" in session.requests[0][0]


async def test_strips_dashes_from_the_uuid():
    dashed = dash_uuid(UUID)
    client, _ = make_client([FakeResponse(200, {"id": dashed, "name": "X"})])

    profile = await client.fetch_profile("Player")

    assert profile.uuid == UUID


@pytest.mark.parametrize("status", [204, 404])
async def test_missing_account_raises_player_not_found(status):
    client, _ = make_client([FakeResponse(status, None)])

    with pytest.raises(PlayerNotFound):
        await client.fetch_profile("Nobody")


async def test_response_without_an_id_raises_player_not_found():
    client, _ = make_client([FakeResponse(200, {"name": "Nobody"})])

    with pytest.raises(PlayerNotFound):
        await client.fetch_profile("Nobody")


async def test_invalid_username_is_rejected_without_a_request():
    client, session = make_client([])

    with pytest.raises(PlayerNotFound):
        await client.fetch_profile("no")
    with pytest.raises(PlayerNotFound):
        await client.fetch_profile("way-too-long-for-minecraft")
    with pytest.raises(PlayerNotFound):
        await client.fetch_profile("has spaces")

    assert session.request_count == 0


async def test_rate_limit_is_an_upstream_failure():
    client, _ = make_client([FakeResponse(429, None)])

    with pytest.raises(UpstreamUnavailable):
        await client.fetch_profile("Player")


async def test_connection_error_is_an_upstream_failure():
    client, _ = make_client([aiohttp.ClientConnectionError("boom")])

    with pytest.raises(UpstreamUnavailable) as excinfo:
        await client.fetch_profile("Player")
    assert "Mojang" in str(excinfo.value)


async def test_timeout_is_an_upstream_failure():
    client, _ = make_client([TimeoutError()])

    with pytest.raises(UpstreamUnavailable):
        await client.fetch_profile("Player")


async def test_unexpected_body_is_an_upstream_failure():
    client, _ = make_client([FakeResponse(200, ["unexpected"])])

    with pytest.raises(UpstreamUnavailable):
        await client.fetch_profile("Player")


@pytest.mark.parametrize(
    ("username", "valid"),
    [("abc", True), ("ab", False), ("Player_123", True), ("a" * 16, True),
     ("a" * 17, False), ("has space", False), ("dash-name", False), ("", False)],
)
def test_username_validation(username, valid):
    assert is_valid_username(username) is valid


def test_dash_uuid():
    assert dash_uuid(UUID) == "b3f1a2c4-7d8e-4f0a-9b6c-5d4e3f2a1b09"
    # Anything that is not 32 hex characters is returned untouched.
    assert dash_uuid("short") == "short"
