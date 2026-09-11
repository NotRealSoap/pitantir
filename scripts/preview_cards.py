"""Render every card to PNG files for eyeballing layout changes.

    python scripts/preview_cards.py [output_dir]

Uses the checked-in test fixture, so it needs no API key or network access.
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from round105.config import _find_font
from round105.ranks import resolve_rank
from round105.rendering import (
    Theme,
    render_kills_card,
    render_leaderboard_card,
    render_map_card,
    render_overview_card,
)
from round105.service import Leaderboard, LeaderboardEntry, PlayerSnapshot
from round105.zombies import MAPS, find_metric, parse_zombies_stats

FIXTURE = Path(__file__).parent.parent / "tests" / "data" / "sample_player.json"

SAMPLE_NAMES = (
    ("Nightfall", {"monthlyPackageRank": "SUPERSTAR", "rankPlusColor": "AQUA"}),
    ("RoundRunner", {"newPackageRank": "MVP_PLUS", "rankPlusColor": "RED"}),
    ("Clutchable", {"newPackageRank": "MVP"}),
    ("WallRepairman", {"newPackageRank": "VIP_PLUS"}),
    ("Zedhunter", {"newPackageRank": "VIP"}),
    ("PlainJane", {}),
    ("AlienWrangler", {"rank": "YOUTUBER"}),
    ("Barricade", {"newPackageRank": "MVP"}),
)


def main() -> int:
    out_dir = Path(sys.argv[1] if len(sys.argv) > 1 else "preview")
    out_dir.mkdir(parents=True, exist_ok=True)

    player = json.loads(FIXTURE.read_text())
    theme = Theme(font_regular=_find_font("regular"), font_bold=_find_font("bold"))

    snapshot = PlayerSnapshot(
        uuid=player["uuid"],
        name=player["displayname"],
        rank=resolve_rank(player),
        stats=parse_zombies_stats(player),
        fetched_at=time.time(),
        source="live",
        player=player,
    )

    written: list[Path] = []

    def write(name: str, data: bytes) -> None:
        path = out_dir / name
        path.write_bytes(data)
        written.append(path)

    write("stats.png", render_overview_card(snapshot, theme))
    write("kills.png", render_kills_card(snapshot, theme))
    for zombies_map in MAPS:
        write(f"{zombies_map.id}.png", render_map_card(snapshot, zombies_map, theme))

    # A player with no Zombies games, to check the empty states.
    empty = PlayerSnapshot(
        uuid="0" * 32,
        name="NeverPlayed",
        rank=resolve_rank({}),
        stats=parse_zombies_stats({}),
        fetched_at=time.time() - 5_400,
        source="stale",
        player={},
    )
    write("stats_empty.png", render_overview_card(empty, theme))
    write("deadend_empty.png", render_map_card(empty, MAPS[0], theme))

    metric = find_metric("kills")
    entries = [
        LeaderboardEntry(
            position=index,
            uuid=f"{index:032d}",
            name=name,
            rank=resolve_rank(rank_fields),
            value=float(187_432 // index),
            display_value=metric.format(187_432 // index),
            age_seconds=index * 95,
        )
        for index, (name, rank_fields) in enumerate(SAMPLE_NAMES, start=1)
    ]
    write(
        "rankings.png",
        render_leaderboard_card(
            Leaderboard(
                metric=metric,
                entries=entries,
                players_ranked=len(entries),
                players_cached=len(entries) + 3,
            ),
            theme,
            "Players this bot has looked up, ranked from cached data",
        ),
    )

    for path in written:
        print(f"{path} ({path.stat().st_size:,} bytes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
