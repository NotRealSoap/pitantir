"""Persistent SQLite cache for player data.

The cache serves three jobs:

1. Stay inside Hypixel's rate limit by answering repeat lookups locally for
   :attr:`Config.cache_ttl_seconds`.
2. Keep the bot useful when Hypixel is down, by serving expired rows as a
   last resort.
3. Back the rankings command. Leaderboards are built only from players this bot
   has already been asked about, so no command ever crawls the API.

Rows are never evicted on read; an expired row is still a valid fallback and a
valid leaderboard entry. Use :meth:`PlayerStore.prune` to bound the file size.
"""

from __future__ import annotations

import json
import sqlite3
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Iterator, Mapping

from .zombies import ZombiesStats, extract_arcade_stats, parse_zombies_stats

SCHEMA_VERSION = 1

#: Fields kept from a Hypixel player object, alongside its Zombies stats. These
#: are what the renderer needs to draw a name plate.
_PLAYER_FIELDS: tuple[str, ...] = (
    "displayname",
    "rank",
    "prefix",
    "packageRank",
    "newPackageRank",
    "monthlyPackageRank",
    "rankPlusColor",
    "monthlyRankColor",
    "firstLogin",
    "lastLogin",
)

_SCHEMA = """
CREATE TABLE IF NOT EXISTS players (
    uuid       TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    name_lower TEXT NOT NULL,
    payload    TEXT NOT NULL,
    fetched_at REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS players_name_lower ON players (name_lower);

CREATE TABLE IF NOT EXISTS names (
    name_lower TEXT PRIMARY KEY,
    uuid       TEXT NOT NULL,
    name       TEXT NOT NULL,
    fetched_at REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
"""


def trim_player(player: Mapping[str, Any]) -> dict[str, Any]:
    """Reduce a Hypixel player object to the fields this bot renders.

    The result is still shaped like a player object, so it can be fed straight
    back into :func:`~round105.zombies.parse_zombies_stats` and
    :func:`~round105.ranks.resolve_rank`.
    """

    trimmed: dict[str, Any] = {
        key: player[key] for key in _PLAYER_FIELDS if key in player
    }
    trimmed["stats"] = {"Arcade": extract_arcade_stats(player)}
    return trimmed


@dataclass(frozen=True)
class CachedPlayer:
    """A stored player row."""

    uuid: str
    name: str
    player: Mapping[str, Any]
    fetched_at: float

    def age(self, now: float | None = None) -> float:
        """Seconds since this row was written."""

        return max((now if now is not None else time.time()) - self.fetched_at, 0.0)

    def is_fresh(self, ttl_seconds: float, now: float | None = None) -> bool:
        return self.age(now) < ttl_seconds

    def stats(self) -> ZombiesStats:
        return parse_zombies_stats(self.player)


@dataclass(frozen=True)
class CachedName:
    """A stored username to UUID mapping."""

    uuid: str
    name: str
    fetched_at: float

    def is_fresh(self, ttl_seconds: float, now: float | None = None) -> bool:
        age = (now if now is not None else time.time()) - self.fetched_at
        return age < ttl_seconds


class PlayerStore:
    """Thread-safe SQLite-backed cache.

    All methods are synchronous and quick, but they do touch the disk; callers on
    the event loop should dispatch them with :func:`asyncio.to_thread`.
    """

    def __init__(
        self,
        path: Path | str = "data/cache.sqlite3",
        time_source: Callable[[], float] = time.time,
    ) -> None:
        self._path = Path(path)
        self._time = time_source
        self._lock = threading.Lock()

        if self._path.parent and str(self._path.parent) not in ("", "."):
            self._path.parent.mkdir(parents=True, exist_ok=True)

        self._connection = sqlite3.connect(
            self._path, check_same_thread=False, isolation_level=None
        )
        self._connection.row_factory = sqlite3.Row
        self._initialise()

    def _initialise(self) -> None:
        with self._lock:
            # WAL keeps reads from blocking behind the write of a fresh lookup.
            self._connection.execute("PRAGMA journal_mode=WAL")
            self._connection.execute("PRAGMA synchronous=NORMAL")
            self._connection.executescript(_SCHEMA)
            self._connection.execute(
                "INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', ?)",
                (str(SCHEMA_VERSION),),
            )

    def close(self) -> None:
        with self._lock:
            self._connection.close()

    def __enter__(self) -> "PlayerStore":
        return self

    def __exit__(self, *_exc: object) -> None:
        self.close()

    # -- players ---------------------------------------------------------

    def put_player(
        self, uuid: str, name: str, player: Mapping[str, Any]
    ) -> CachedPlayer:
        """Store (or refresh) a player, keeping only the fields we render."""

        payload = trim_player(player)
        fetched_at = self._time()
        with self._lock:
            self._connection.execute(
                """
                INSERT INTO players (uuid, name, name_lower, payload, fetched_at)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(uuid) DO UPDATE SET
                    name = excluded.name,
                    name_lower = excluded.name_lower,
                    payload = excluded.payload,
                    fetched_at = excluded.fetched_at
                """,
                (uuid, name, name.lower(), json.dumps(payload), fetched_at),
            )
        return CachedPlayer(
            uuid=uuid, name=name, player=payload, fetched_at=fetched_at
        )

    def get_player(self, uuid: str) -> CachedPlayer | None:
        """Fetch a player by UUID regardless of age."""

        with self._lock:
            row = self._connection.execute(
                "SELECT * FROM players WHERE uuid = ?", (uuid,)
            ).fetchone()
        return _row_to_player(row)

    def get_player_by_name(self, name: str) -> CachedPlayer | None:
        """Fetch the most recently seen player with this username."""

        with self._lock:
            row = self._connection.execute(
                """
                SELECT * FROM players WHERE name_lower = ?
                ORDER BY fetched_at DESC LIMIT 1
                """,
                (name.lower(),),
            ).fetchone()
        return _row_to_player(row)

    def iter_players(self) -> Iterator[CachedPlayer]:
        """Iterate every cached player, newest first.

        Used to build leaderboards. Rows are read in one pass under the lock so a
        concurrent write cannot interleave with a ranking.
        """

        with self._lock:
            rows = self._connection.execute(
                "SELECT * FROM players ORDER BY fetched_at DESC"
            ).fetchall()
        for row in rows:
            player = _row_to_player(row)
            if player is not None:
                yield player

    def count_players(self) -> int:
        with self._lock:
            row = self._connection.execute("SELECT COUNT(*) FROM players").fetchone()
        return int(row[0]) if row else 0

    def prune(self, max_age_seconds: float) -> int:
        """Delete rows older than ``max_age_seconds``. Returns rows removed."""

        cutoff = self._time() - max_age_seconds
        with self._lock:
            cursor = self._connection.execute(
                "DELETE FROM players WHERE fetched_at < ?", (cutoff,)
            )
            removed = cursor.rowcount or 0
            self._connection.execute(
                "DELETE FROM names WHERE fetched_at < ?", (cutoff,)
            )
        return removed

    # -- username -> uuid ------------------------------------------------

    def put_name(self, name: str, uuid: str) -> CachedName:
        fetched_at = self._time()
        with self._lock:
            self._connection.execute(
                """
                INSERT INTO names (name_lower, uuid, name, fetched_at)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(name_lower) DO UPDATE SET
                    uuid = excluded.uuid,
                    name = excluded.name,
                    fetched_at = excluded.fetched_at
                """,
                (name.lower(), uuid, name, fetched_at),
            )
        return CachedName(uuid=uuid, name=name, fetched_at=fetched_at)

    def get_name(self, name: str) -> CachedName | None:
        with self._lock:
            row = self._connection.execute(
                "SELECT * FROM names WHERE name_lower = ?", (name.lower(),)
            ).fetchone()
        if row is None:
            return None
        return CachedName(
            uuid=row["uuid"], name=row["name"], fetched_at=float(row["fetched_at"])
        )


def _row_to_player(row: sqlite3.Row | None) -> CachedPlayer | None:
    if row is None:
        return None
    try:
        payload = json.loads(row["payload"])
    except (TypeError, ValueError):
        payload = {}
    if not isinstance(payload, dict):
        payload = {}
    return CachedPlayer(
        uuid=row["uuid"],
        name=row["name"],
        player=payload,
        fetched_at=float(row["fetched_at"]),
    )
