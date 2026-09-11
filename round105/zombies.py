"""Parsing of Hypixel Zombies statistics.

Zombies stats live in a flat key/value dict at ``player.stats.Arcade``, where the
key encodes the scope of the counter:

===========================================  ==========================================
``zombies_zombie_kills``                     all maps combined
``zombies_zombie_kills_deadend``             one map
``zombies_best_round_deadend_hard``          one map on one difficulty
``zombies_fastest_time_30_deadend_normal``   seconds to clear 30 rounds on a difficulty
===========================================  ==========================================

Hypixel adds and renames these counters over time and omits any counter a player
has never incremented, so every read goes through :func:`_read_int`, which treats
a missing or non-numeric value as zero. That keeps a stat card rendering even when
the API shape drifts.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Iterable, Mapping

#: Seconds-to-clear milestones Hypixel tracks per map and difficulty.
TIME_MILESTONES: tuple[int, ...] = (10, 20, 30)


@dataclass(frozen=True)
class Difficulty:
    """A difficulty a map can be played on."""

    id: str
    label: str


NORMAL = Difficulty("normal", "Normal")
HARD = Difficulty("hard", "Hard")
RIP = Difficulty("rip", "R.I.P.")

STANDARD_DIFFICULTIES: tuple[Difficulty, ...] = (NORMAL, HARD, RIP)


@dataclass(frozen=True)
class ZombiesMap:
    """Static description of a Zombies map."""

    id: str
    label: str
    #: Suffix Hypixel appends to stat keys for this map.
    api_suffix: str
    #: Accent colour used when rendering this map's card, as ``#rrggbb``.
    accent: str
    #: Round that completes the map, or ``None`` when the map is endless.
    final_round: int | None
    difficulties: tuple[Difficulty, ...] = STANDARD_DIFFICULTIES
    #: Command aliases users can type instead of the full map name.
    aliases: tuple[str, ...] = ()

    @property
    def is_endless(self) -> bool:
        return self.final_round is None


DEAD_END = ZombiesMap(
    id="deadend",
    label="Dead End",
    api_suffix="deadend",
    accent="#4f9d5d",
    final_round=30,
    aliases=("de", "dead_end", "dead-end"),
)
BAD_BLOOD = ZombiesMap(
    id="badblood",
    label="Bad Blood",
    api_suffix="badblood",
    accent="#b23a48",
    final_round=30,
    aliases=("bb", "bad_blood", "bad-blood"),
)
PRISON = ZombiesMap(
    id="prison",
    label="Prison",
    api_suffix="prison",
    accent="#5c7cb0",
    final_round=30,
    aliases=("pr", "prsn"),
)
ALIEN_ARCADIUM = ZombiesMap(
    id="alienarcadium",
    label="Alien Arcadium",
    api_suffix="alienarcadium",
    accent="#8e5bb5",
    # Alien Arcadium has no difficulty selector and no completion round; the
    # community treats round 105 as the practical ceiling.
    final_round=None,
    difficulties=(),
    aliases=("aa", "alien", "alien_arcadium", "arcadium"),
)

MAPS: tuple[ZombiesMap, ...] = (DEAD_END, BAD_BLOOD, PRISON, ALIEN_ARCADIUM)

_MAP_LOOKUP: dict[str, ZombiesMap] = {}
for _map in MAPS:
    _MAP_LOOKUP[_map.id] = _map
    _MAP_LOOKUP[_map.label.lower()] = _map
    for _alias in _map.aliases:
        _MAP_LOOKUP[_alias] = _map


def find_map(name: str) -> ZombiesMap | None:
    """Look up a map by id, label, or alias. Case and spacing insensitive."""

    return _MAP_LOOKUP.get(name.strip().lower().replace(" ", ""))


def _read_int(source: Mapping[str, Any], key: str) -> int:
    """Read an integer counter, treating missing or malformed values as zero."""

    value = source.get(key)
    if isinstance(value, bool):
        return 0
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value)
    if isinstance(value, str):
        try:
            return int(float(value))
        except ValueError:
            return 0
    return 0


def _ratio(numerator: int, denominator: int) -> float:
    """Divide two counters, yielding 0.0 rather than dividing by zero.

    A player with kills but no deaths would otherwise produce infinity, which
    neither sorts nor renders sensibly, so their kill count stands in as the
    ratio - the same convention Hypixel's own leaderboards use.
    """

    if denominator > 0:
        return numerator / denominator
    return float(numerator)


@dataclass(frozen=True)
class DifficultyStats:
    """Per-difficulty results for a single map."""

    difficulty: Difficulty
    wins: int = 0
    best_round: int = 0
    rounds_survived: int = 0
    #: Milestone (10/20/30 rounds) -> fastest completion in seconds.
    fastest_times: Mapping[int, int] = field(default_factory=dict)

    @property
    def played(self) -> bool:
        return bool(
            self.wins or self.best_round or self.rounds_survived or self.fastest_times
        )

    def fastest_time(self, milestone: int) -> int | None:
        """Fastest clear of ``milestone`` rounds in seconds, if ever achieved."""

        seconds = self.fastest_times.get(milestone, 0)
        return seconds or None


@dataclass(frozen=True)
class CombatStats:
    """Shooting and survival counters shared by the overall and per-map scopes."""

    zombie_kills: int = 0
    deaths: int = 0
    wins: int = 0
    best_round: int = 0
    rounds_survived: int = 0
    players_revived: int = 0
    windows_repaired: int = 0
    doors_opened: int = 0
    bullets_hit: int = 0
    bullets_shot: int = 0
    headshots: int = 0

    @property
    def kill_death_ratio(self) -> float:
        return _ratio(self.zombie_kills, self.deaths)

    @property
    def accuracy(self) -> float:
        """Fraction of fired bullets that connected, in ``0.0``-``1.0``."""

        if self.bullets_shot <= 0:
            return 0.0
        return min(self.bullets_hit / self.bullets_shot, 1.0)

    @property
    def headshot_rate(self) -> float:
        """Fraction of connecting bullets that were headshots."""

        if self.bullets_hit <= 0:
            return 0.0
        return min(self.headshots / self.bullets_hit, 1.0)

    @property
    def kills_per_round(self) -> float:
        return _ratio(self.zombie_kills, self.rounds_survived)

    @property
    def has_data(self) -> bool:
        return bool(
            self.zombie_kills
            or self.deaths
            or self.wins
            or self.rounds_survived
            or self.best_round
            or self.bullets_shot
        )


@dataclass(frozen=True)
class MapStats:
    """A player's record on one map."""

    map: ZombiesMap
    combat: CombatStats
    difficulties: Mapping[str, DifficultyStats] = field(default_factory=dict)

    @property
    def has_data(self) -> bool:
        return self.combat.has_data

    @property
    def completed(self) -> bool:
        """Whether the player has ever beaten the map's final round."""

        if self.map.is_endless:
            return False
        return self.combat.wins > 0

    def difficulty(self, difficulty_id: str) -> DifficultyStats | None:
        return self.difficulties.get(difficulty_id)

    def played_difficulties(self) -> list[DifficultyStats]:
        return [d for d in self.difficulties.values() if d.played]


@dataclass(frozen=True)
class ZombiesStats:
    """A player's complete Zombies record."""

    overall: CombatStats
    maps: Mapping[str, MapStats]

    @property
    def has_data(self) -> bool:
        return self.overall.has_data or any(m.has_data for m in self.maps.values())

    def map_stats(self, zombies_map: ZombiesMap) -> MapStats:
        return self.maps[zombies_map.id]

    def maps_played(self) -> list[MapStats]:
        return [self.maps[m.id] for m in MAPS if self.maps[m.id].has_data]

    @property
    def maps_completed(self) -> int:
        return sum(1 for m in self.maps.values() if m.completed)


def _suffixed(base: str, *parts: str) -> str:
    return "_".join((base, *(p for p in parts if p)))


def _parse_combat(arcade: Mapping[str, Any], suffix: str = "") -> CombatStats:
    """Read the combat counters for one scope (overall when ``suffix`` is empty)."""

    def count(stat: str) -> int:
        return _read_int(arcade, _suffixed(f"zombies_{stat}", suffix))

    # Hypixel's win counter is the one key that puts "zombies" second.
    wins = _read_int(arcade, _suffixed("wins_zombies", suffix))

    # Older entries used "zombies_revives"; newer ones "zombies_players_revived".
    revived = count("players_revived") or count("revives")

    return CombatStats(
        zombie_kills=count("zombie_kills"),
        deaths=count("deaths"),
        wins=wins,
        best_round=count("best_round"),
        rounds_survived=count("total_rounds_survived"),
        players_revived=revived,
        windows_repaired=count("windows_repaired"),
        doors_opened=count("doors_opened"),
        bullets_hit=count("bullets_hit"),
        bullets_shot=count("bullets_shot"),
        headshots=count("headshots"),
    )


def _parse_difficulty(
    arcade: Mapping[str, Any], zombies_map: ZombiesMap, difficulty: Difficulty
) -> DifficultyStats:
    scope = f"{zombies_map.api_suffix}_{difficulty.id}"

    fastest: dict[int, int] = {}
    for milestone in TIME_MILESTONES:
        seconds = _read_int(arcade, f"zombies_fastest_time_{milestone}_{scope}")
        if seconds > 0:
            fastest[milestone] = seconds

    return DifficultyStats(
        difficulty=difficulty,
        wins=_read_int(arcade, f"wins_zombies_{scope}"),
        best_round=_read_int(arcade, f"zombies_best_round_{scope}"),
        rounds_survived=_read_int(arcade, f"zombies_total_rounds_survived_{scope}"),
        fastest_times=fastest,
    )


def parse_zombies_stats(player: Mapping[str, Any] | None) -> ZombiesStats:
    """Build a :class:`ZombiesStats` from a Hypixel ``player`` object.

    Accepts a partial or empty player object and returns zeroed stats rather
    than raising, so callers can render "no data" cards through the same path.
    """

    arcade: Mapping[str, Any] = {}
    if player:
        stats = player.get("stats")
        if isinstance(stats, Mapping):
            candidate = stats.get("Arcade")
            if isinstance(candidate, Mapping):
                arcade = candidate

    maps: dict[str, MapStats] = {}
    for zombies_map in MAPS:
        difficulties = {
            difficulty.id: _parse_difficulty(arcade, zombies_map, difficulty)
            for difficulty in zombies_map.difficulties
        }
        maps[zombies_map.id] = MapStats(
            map=zombies_map,
            combat=_parse_combat(arcade, zombies_map.api_suffix),
            difficulties=difficulties,
        )

    return ZombiesStats(overall=_parse_combat(arcade), maps=maps)


def extract_arcade_stats(player: Mapping[str, Any]) -> dict[str, Any]:
    """Return only the Zombies keys from a player's Arcade stats.

    A full Hypixel player object routinely exceeds a megabyte of JSON. The cache
    keeps just the Zombies counters so a stored row stays in the low kilobytes.
    """

    stats = player.get("stats")
    if not isinstance(stats, Mapping):
        return {}
    arcade = stats.get("Arcade")
    if not isinstance(arcade, Mapping):
        return {}
    return {
        key: value
        for key, value in arcade.items()
        if isinstance(key, str)
        and (key.startswith("zombies_") or key.startswith("wins_zombies"))
    }


@dataclass(frozen=True)
class Metric:
    """A sortable stat, used by the rankings command."""

    id: str
    label: str
    #: Extracts the value to rank on from a player's stats.
    extract: Any
    #: Formats a ranked value for display.
    format: Any
    aliases: tuple[str, ...] = ()


def _format_int(value: float) -> str:
    return f"{int(value):,}"


def _format_ratio(value: float) -> str:
    return f"{value:.2f}"


def _format_percent(value: float) -> str:
    return f"{value * 100:.1f}%"


METRICS: tuple[Metric, ...] = (
    Metric(
        "kills",
        "Zombie Kills",
        lambda s: s.overall.zombie_kills,
        _format_int,
        ("zombie_kills",),
    ),
    Metric("wins", "Wins", lambda s: s.overall.wins, _format_int),
    Metric(
        "best_round",
        "Best Round",
        lambda s: s.overall.best_round,
        _format_int,
        ("round", "bestround"),
    ),
    Metric(
        "rounds",
        "Rounds Survived",
        lambda s: s.overall.rounds_survived,
        _format_int,
        ("rounds_survived",),
    ),
    Metric("kdr", "Kill/Death Ratio", lambda s: s.overall.kill_death_ratio, _format_ratio),
    Metric(
        "accuracy", "Accuracy", lambda s: s.overall.accuracy, _format_percent, ("acc",)
    ),
    Metric(
        "revives",
        "Players Revived",
        lambda s: s.overall.players_revived,
        _format_int,
        ("revived",),
    ),
    Metric(
        "doors", "Doors Opened", lambda s: s.overall.doors_opened, _format_int
    ),
    Metric(
        "windows",
        "Windows Repaired",
        lambda s: s.overall.windows_repaired,
        _format_int,
    ),
)

_METRIC_LOOKUP: dict[str, Metric] = {}
for _metric in METRICS:
    _METRIC_LOOKUP[_metric.id] = _metric
    for _alias in _metric.aliases:
        _METRIC_LOOKUP[_alias] = _metric


def find_metric(name: str) -> Metric | None:
    return _METRIC_LOOKUP.get(name.strip().lower().replace(" ", "_"))


def metric_ids() -> Iterable[str]:
    return (metric.id for metric in METRICS)
