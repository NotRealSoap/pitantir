"""Shared fixtures and test doubles."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Mapping

import pytest

from round105.errors import PlayerNotFound, UpstreamUnavailable
from round105.mojang import MojangProfile
from round105.service import StatsService
from round105.store import PlayerStore
from round105.zombies import parse_zombies_stats

DATA_DIR = Path(__file__).parent / "data"

SAMPLE_UUID = "b3f1a2c47d8e4f0a9b6c5d4e3f2a1b09"
SAMPLE_NAME = "RoundRunner"


class Clock:
    """A manually advanced clock, so TTL behaviour is tested without sleeping."""

    def __init__(self, now: float = 1_700_000_000.0) -> None:
        self.now = now

    def __call__(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds


class FakeMojang:
    """Stands in for :class:`round105.mojang.MojangClient`."""

    def __init__(self, profiles: Mapping[str, str] | None = None) -> None:
        self.profiles = dict(profiles or {SAMPLE_NAME: SAMPLE_UUID})
        self.calls: list[str] = []
        self.fail_with: Exception | None = None

    async def fetch_profile(self, username: str) -> MojangProfile:
        self.calls.append(username)
        if self.fail_with is not None:
            raise self.fail_with
        for name, uuid in self.profiles.items():
            if name.lower() == username.lower():
                return MojangProfile(uuid=uuid, name=name)
        raise PlayerNotFound(username)


class FakeHypixel:
    """Stands in for :class:`round105.hypixel.HypixelClient`."""

    def __init__(self, players: Mapping[str, Mapping[str, Any]] | None = None) -> None:
        self.players = dict(players or {})
        self.calls: list[str] = []
        self.fail_with: Exception | None = None
        #: Set to an :class:`asyncio.Event` to hold responses open in tests.
        self.gate = None

    async def fetch_player(self, uuid: str, username: str = "") -> dict[str, Any]:
        self.calls.append(uuid)
        if self.gate is not None:
            await self.gate.wait()
        if self.fail_with is not None:
            raise self.fail_with
        player = self.players.get(uuid)
        if player is None:
            raise UpstreamUnavailable("Hypixel", "no fixture for uuid")
        return dict(player)

    @property
    def call_count(self) -> int:
        return len(self.calls)


@pytest.fixture
def sample_player() -> dict[str, Any]:
    return json.loads((DATA_DIR / "sample_player.json").read_text())


@pytest.fixture
def sample_stats(sample_player):
    return parse_zombies_stats(sample_player)


@pytest.fixture
def clock() -> Clock:
    return Clock()


@pytest.fixture
def store(tmp_path: Path, clock: Clock) -> PlayerStore:
    with PlayerStore(tmp_path / "cache.sqlite3", time_source=clock) as player_store:
        yield player_store


@pytest.fixture
def service(store: PlayerStore, clock: Clock, sample_player):
    """A service wired to fake upstreams and a real on-disk cache."""

    mojang = FakeMojang()
    hypixel = FakeHypixel({SAMPLE_UUID: sample_player})
    stats_service = StatsService(
        mojang=mojang,  # type: ignore[arg-type]
        hypixel=hypixel,  # type: ignore[arg-type]
        store=store,
        cache_ttl_seconds=300,
        name_ttl_seconds=86_400,
        leaderboard_size=10,
        time_source=clock,
    )
    # Attached so tests can assert on and manipulate the doubles.
    stats_service.fake_mojang = mojang  # type: ignore[attr-defined]
    stats_service.fake_hypixel = hypixel  # type: ignore[attr-defined]
    return stats_service
