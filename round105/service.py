"""Orchestration between Mojang, Hypixel, and the local cache.

Command handlers talk only to :class:`StatsService`. It owns the policy for when
to hit the network, when to answer from cache, and what to do when Hypixel is
unavailable, so that policy is decided in one place and can be tested without a
Discord connection.
"""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass
from typing import Any, Callable, Literal, Mapping, Sequence

from .errors import NoZombiesData, RateLimited, UpstreamUnavailable
from .hypixel import HypixelClient
from .mojang import MojangClient
from .ranks import Rank, resolve_rank
from .store import CachedPlayer, PlayerStore
from .zombies import Metric, ZombiesStats, parse_zombies_stats

log = logging.getLogger(__name__)

#: Where a snapshot came from. ``stale`` means the API failed and the cache
#: answered with data past its TTL, which the UI flags to the user.
Source = Literal["live", "cache", "stale"]


@dataclass(frozen=True)
class PlayerSnapshot:
    """A player's Zombies stats at a point in time, ready to render."""

    uuid: str
    name: str
    rank: Rank
    stats: ZombiesStats
    fetched_at: float
    source: Source
    player: Mapping[str, Any]

    @property
    def age_seconds(self) -> float:
        return max(time.time() - self.fetched_at, 0.0)

    @property
    def is_stale(self) -> bool:
        return self.source == "stale"


@dataclass(frozen=True)
class LeaderboardEntry:
    """One row of a ranking."""

    position: int
    uuid: str
    name: str
    rank: Rank
    value: float
    display_value: str
    age_seconds: float


@dataclass(frozen=True)
class Leaderboard:
    """A ranking built from cached players."""

    metric: Metric
    entries: Sequence[LeaderboardEntry]
    #: Cached players that had Zombies data and were eligible for ranking.
    players_ranked: int
    #: Total cached players, including those skipped for having no Zombies data.
    players_cached: int


class StatsService:
    """Resolves usernames and produces renderable stat snapshots."""

    def __init__(
        self,
        mojang: MojangClient,
        hypixel: HypixelClient,
        store: PlayerStore,
        cache_ttl_seconds: int = 300,
        name_ttl_seconds: int = 86_400,
        leaderboard_size: int = 10,
        time_source: Callable[[], float] = time.time,
    ) -> None:
        self._mojang = mojang
        self._hypixel = hypixel
        self._store = store
        self._cache_ttl = cache_ttl_seconds
        self._name_ttl = name_ttl_seconds
        self._leaderboard_size = leaderboard_size
        self._time = time_source
        #: One in-flight fetch per UUID. Without this, several users running
        #: /stats on the same player at once would each spend a request.
        self._inflight: dict[str, asyncio.Task[CachedPlayer]] = {}

    @property
    def leaderboard_size(self) -> int:
        return self._leaderboard_size

    async def lookup(self, username: str, *, require_data: bool = True) -> PlayerSnapshot:
        """Return a player's Zombies stats, from cache when fresh.

        Raises a :class:`~round105.errors.Round105Error` subclass when the player
        cannot be resolved, has no Zombies data (unless ``require_data`` is
        false), or when both the API and the cache come up empty.
        """

        uuid, name = await self._resolve_uuid(username)

        cached = await asyncio.to_thread(self._store.get_player, uuid)
        if cached is not None and cached.is_fresh(self._cache_ttl, self._time()):
            return self._snapshot(cached, "cache", require_data=require_data)

        try:
            fresh = await self._fetch_player(uuid, name)
        except (UpstreamUnavailable, RateLimited) as exc:
            if cached is not None:
                log.warning(
                    "Serving stale data for %s (age %.0fs) after upstream failure: %s",
                    name,
                    cached.age(self._time()),
                    exc,
                )
                return self._snapshot(cached, "stale", require_data=require_data)
            raise

        return self._snapshot(fresh, "live", require_data=require_data)

    async def _fetch_player(self, uuid: str, name: str) -> CachedPlayer:
        """Fetch and store a player, collapsing concurrent requests per UUID."""

        existing = self._inflight.get(uuid)
        if existing is not None:
            return await asyncio.shield(existing)

        async def run() -> CachedPlayer:
            player = await self._hypixel.fetch_player(uuid, name)
            # Prefer the display name Hypixel reports; it has the right casing.
            display = player.get("displayname")
            resolved_name = display if isinstance(display, str) and display else name
            return await asyncio.to_thread(
                self._store.put_player, uuid, resolved_name, player
            )

        task = asyncio.create_task(run())
        self._inflight[uuid] = task
        try:
            return await asyncio.shield(task)
        finally:
            # Only the originating call clears the slot, and only once the task
            # is settled, so late joiners still find it.
            if self._inflight.get(uuid) is task and task.done():
                del self._inflight[uuid]

    async def _resolve_uuid(self, username: str) -> tuple[str, str]:
        """Resolve a username to ``(uuid, display_name)``.

        Falls back to previously seen mappings if Mojang is unreachable, since a
        username almost never changes owner.
        """

        cached_name = await asyncio.to_thread(self._store.get_name, username)
        if cached_name is not None and cached_name.is_fresh(
            self._name_ttl, self._time()
        ):
            return cached_name.uuid, cached_name.name

        try:
            profile = await self._mojang.fetch_profile(username)
        except UpstreamUnavailable:
            if cached_name is not None:
                log.warning("Using stale UUID mapping for %s", username)
                return cached_name.uuid, cached_name.name
            cached_player = await asyncio.to_thread(
                self._store.get_player_by_name, username
            )
            if cached_player is not None:
                log.warning("Using cached player row to resolve %s", username)
                return cached_player.uuid, cached_player.name
            raise

        await asyncio.to_thread(self._store.put_name, profile.name, profile.uuid)
        return profile.uuid, profile.name

    def _snapshot(
        self, cached: CachedPlayer, source: Source, *, require_data: bool
    ) -> PlayerSnapshot:
        stats = parse_zombies_stats(cached.player)
        if require_data and not stats.has_data:
            raise NoZombiesData(cached.name)
        return PlayerSnapshot(
            uuid=cached.uuid,
            name=cached.name,
            rank=resolve_rank(cached.player),
            stats=stats,
            fetched_at=cached.fetched_at,
            source=source,
            player=cached.player,
        )

    async def leaderboard(self, metric: Metric, limit: int | None = None) -> Leaderboard:
        """Rank cached players by ``metric``.

        Reads only local data: a player appears once the bot has looked them up
        for some other command. This keeps the command free of API cost, at the
        cost of being a ranking of "players this bot knows about" rather than of
        Hypixel as a whole.
        """

        size = limit or self._leaderboard_size
        now = self._time()

        rows = await asyncio.to_thread(list, self._store.iter_players())

        scored: list[tuple[float, str, CachedPlayer, ZombiesStats]] = []
        for row in rows:
            stats = parse_zombies_stats(row.player)
            if not stats.has_data:
                continue
            scored.append((float(metric.extract(stats)), row.name.lower(), row, stats))

        # Descending by value, then by name so equal scores have a stable order.
        scored.sort(key=lambda item: (-item[0], item[1]))

        entries = [
            LeaderboardEntry(
                position=index,
                uuid=row.uuid,
                name=row.name,
                rank=resolve_rank(row.player),
                value=value,
                display_value=metric.format(value),
                age_seconds=row.age(now),
            )
            for index, (value, _sort_name, row, _stats) in enumerate(
                scored[:size], start=1
            )
        ]

        return Leaderboard(
            metric=metric,
            entries=entries,
            players_ranked=len(scored),
            players_cached=len(rows),
        )
