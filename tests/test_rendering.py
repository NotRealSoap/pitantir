"""Tests for card rendering.

These assert that every card produces a decodable PNG of the expected width for
a range of inputs, including the degenerate ones (no data, empty leaderboard).
Exact pixel output is deliberately not asserted, so the layout can be tweaked
without rewriting the tests.
"""

from __future__ import annotations

import io
from dataclasses import replace

import pytest
from PIL import Image

from round105.rendering import (
    render_kills_card,
    render_leaderboard_card,
    render_map_card,
    render_overview_card,
)
from round105.rendering.theme import Layout
from round105.service import Leaderboard, LeaderboardEntry
from round105.zombies import MAPS, find_metric, parse_zombies_stats

PNG_MAGIC = b"\x89PNG\r\n\x1a\n"


def open_png(data: bytes) -> Image.Image:
    assert data.startswith(PNG_MAGIC)
    image = Image.open(io.BytesIO(data))
    image.load()
    return image


def test_overview_card_renders(snapshot, theme):
    image = open_png(render_overview_card(snapshot, theme))

    assert image.format == "PNG"
    assert image.width == Layout().width
    assert image.height > 300


@pytest.mark.parametrize("zombies_map", MAPS, ids=[m.id for m in MAPS])
def test_map_cards_render(snapshot, theme, zombies_map):
    image = open_png(render_map_card(snapshot, zombies_map, theme))

    assert image.width == Layout().width
    assert image.height > 300


def test_kills_card_renders(snapshot, theme):
    image = open_png(render_kills_card(snapshot, theme))

    assert image.width == Layout().width


def test_cards_render_for_a_player_with_no_data(snapshot, theme):
    """A zeroed snapshot must still produce a card rather than crash."""

    empty = replace(snapshot, stats=parse_zombies_stats({}))

    for renderer in (render_overview_card, render_kills_card):
        assert open_png(renderer(empty, theme)).width == Layout().width

    for zombies_map in MAPS:
        assert open_png(render_map_card(empty, zombies_map, theme)).width


def test_stale_snapshot_renders(snapshot, theme):
    stale = replace(snapshot, source="stale", fetched_at=snapshot.fetched_at - 7_200)
    assert open_png(render_overview_card(stale, theme)).width == Layout().width


def test_long_username_does_not_overflow(snapshot, theme):
    long_name = replace(snapshot, name="Xx_ARatherLongName_xX")
    assert open_png(render_overview_card(long_name, theme)).width == Layout().width


def _leaderboard(count: int) -> Leaderboard:
    entries = [
        LeaderboardEntry(
            position=index,
            uuid=f"uuid-{index}",
            name=f"Player{index}",
            rank=replace_rank(index),
            value=float(10_000 - index * 900),
            display_value=f"{10_000 - index * 900:,}",
            age_seconds=index * 70,
        )
        for index in range(1, count + 1)
    ]
    return Leaderboard(
        metric=find_metric("kills"),
        entries=entries,
        players_ranked=count,
        players_cached=count + 2,
    )


def replace_rank(index: int):
    from round105.ranks import resolve_rank

    packages = [{}, {"newPackageRank": "MVP_PLUS"}, {"monthlyPackageRank": "SUPERSTAR"}]
    return resolve_rank(packages[index % len(packages)])


def test_leaderboard_card_renders(theme):
    image = open_png(render_leaderboard_card(_leaderboard(10), theme, "Top players"))

    assert image.width == Layout().width
    assert image.height > 200


def test_empty_leaderboard_card_renders(theme):
    board = Leaderboard(
        metric=find_metric("kills"), entries=[], players_ranked=0, players_cached=0
    )
    assert open_png(render_leaderboard_card(board, theme, "Nothing yet")).width


def test_single_entry_leaderboard_card_renders(theme):
    assert open_png(render_leaderboard_card(_leaderboard(1), theme, "One")).width


def test_cards_render_without_a_configured_font(snapshot):
    """A missing font path must fall back rather than raise."""

    from round105.rendering import Theme

    fallback = Theme(font_regular="/nope/missing.ttf", font_bold=None)
    assert open_png(render_overview_card(snapshot, fallback)).width == Layout().width
