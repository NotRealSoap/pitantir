"""Stat card layouts.

Each ``render_*`` function takes domain objects and returns a PNG as raw bytes,
ready to attach to a Discord message. Rendering is CPU-bound and synchronous;
the cog dispatches it with :func:`asyncio.to_thread`.
"""

from __future__ import annotations

import io
from typing import Sequence

from ..formatting import (
    compact,
    duration,
    percent,
    ratio,
    relative_age,
    thousands,
)
from ..ranks import Rank
from ..service import Leaderboard, PlayerSnapshot
from ..zombies import MapStats, ZombiesMap, ZombiesStats
from .theme import Canvas, Layout, Theme, Tile

TITLE_SIZE = 32
SUBTITLE_SIZE = 16
LABEL_SIZE = 13
VALUE_SIZE = 25
HINT_SIZE = 12
TABLE_SIZE = 15
FOOTER_SIZE = 12


def _to_png(canvas: Canvas) -> bytes:
    buffer = io.BytesIO()
    canvas.to_image().save(buffer, format="PNG", optimize=True)
    return buffer.getvalue()


def _draw_name_plate(
    canvas: Canvas,
    xy: tuple[float, float],
    rank: Rank,
    name: str,
    *,
    size: int,
    right_limit: float,
    gap: float = 10,
) -> float:
    """Draw ``[TAG] Username``, returning the x position after the name.

    The tag's own runs are drawn flush against each other so a tag such as
    ``[MVP++]`` keeps its shape; only the space before the username is padded.
    The name is truncated to stop before ``right_limit``.
    """

    x, y = xy
    if rank.has_tag:
        x = (
            canvas.text_runs(
                (x, y), rank.segments(), weight="bold", size=size, anchor="ls"
            )
            + gap
        )

    label = canvas.truncate(
        name, max(right_limit - x, size), weight="bold", size=size
    )
    canvas.text(
        (x, y),
        label,
        weight="bold",
        size=size,
        color=rank.name_color() if rank.has_tag else canvas.theme.text,
        anchor="ls",
    )
    return x + canvas.text_width(label, weight="bold", size=size)


def _draw_header(
    canvas: Canvas,
    layout: Layout,
    rank: Rank,
    name: str,
    subtitle: str,
    accent: str,
    badge: str | None = None,
) -> float:
    """Draw the name plate and return the y position where the body starts."""

    theme = canvas.theme
    top = layout.margin
    bottom = top + layout.header_height

    canvas.rounded_rect(
        (layout.content_left, top, layout.content_right, bottom),
        layout.radius,
        fill=theme.panel,
    )
    # Accent stripe down the left edge, tinted per map.
    canvas.rounded_rect(
        (layout.content_left, top, layout.content_left + 6, bottom),
        3,
        fill=accent,
    )

    # The badge is placed first so the name knows how much room it has.
    right_limit = layout.content_right - 24
    if badge:
        right_limit = _draw_badge(canvas, layout, badge, accent, top, bottom) - 16

    text_left = layout.content_left + 24
    name_baseline = top + 46

    _draw_name_plate(
        canvas,
        (text_left, name_baseline),
        rank,
        name,
        size=TITLE_SIZE,
        right_limit=right_limit,
    )

    canvas.text(
        (text_left, name_baseline + 12),
        subtitle,
        size=SUBTITLE_SIZE,
        color=theme.text_muted,
        anchor="la",
    )

    return bottom + layout.tile_gap + 6


def _draw_badge(
    canvas: Canvas,
    layout: Layout,
    text: str,
    accent: str,
    top: float,
    bottom: float,
) -> float:
    """Draw a pill on the right of the header, returning its left edge."""

    theme = canvas.theme
    padding = 16
    text_w = canvas.text_width(text, weight="bold", size=LABEL_SIZE)
    right = layout.content_right - 22
    left = right - text_w - 2 * padding
    height = 30
    mid = (top + bottom) / 2
    canvas.rounded_rect(
        (left, mid - height / 2, right, mid + height / 2),
        height / 2,
        fill=theme.panel_alt,
        outline=accent,
        width=1,
    )
    canvas.text(
        ((left + right) / 2, mid),
        text,
        weight="bold",
        size=LABEL_SIZE,
        color=accent,
        anchor="mm",
    )
    return left


def _draw_tiles(
    canvas: Canvas,
    layout: Layout,
    tiles: Sequence[Tile],
    top: float,
    columns: int = 4,
) -> float:
    """Draw a grid of stat tiles and return the y position below them."""

    theme = canvas.theme
    if not tiles:
        return top

    gap = layout.tile_gap
    tile_w = (layout.content_width - gap * (columns - 1)) / columns
    y = top

    for index, tile in enumerate(tiles):
        column = index % columns
        if column == 0 and index:
            y += layout.tile_height + gap

        x0 = layout.content_left + column * (tile_w + gap)
        x1 = x0 + tile_w
        y1 = y + layout.tile_height

        canvas.rounded_rect((x0, y, x1, y1), 10, fill=theme.panel)
        canvas.text(
            (x0 + 14, y + 16),
            tile.label.upper(),
            weight="bold",
            size=LABEL_SIZE,
            color=theme.text_dim,
            anchor="la",
        )
        value = canvas.truncate(
            tile.value, tile_w - 28, weight="bold", size=VALUE_SIZE
        )
        canvas.text(
            (x0 + 14, y1 - 16),
            value,
            weight="bold",
            size=VALUE_SIZE,
            color=tile.color or theme.text,
            anchor="ls",
        )
        if tile.hint:
            canvas.text(
                (x1 - 14, y + 18),
                tile.hint,
                size=HINT_SIZE,
                color=theme.text_dim,
                anchor="ra",
            )

    return y + layout.tile_height + gap


def _draw_section_title(
    canvas: Canvas, layout: Layout, title: str, top: float
) -> float:
    canvas.text(
        (layout.content_left + 2, top),
        title.upper(),
        weight="bold",
        size=LABEL_SIZE,
        color=canvas.theme.text_dim,
        anchor="la",
    )
    return top + 22


def _draw_footer(canvas: Canvas, layout: Layout, left: str, right: str) -> None:
    theme = canvas.theme
    y = canvas.height - layout.margin + 4
    canvas.text(
        (layout.content_left + 2, y),
        left,
        size=FOOTER_SIZE,
        color=theme.text_dim,
        anchor="ls",
    )
    if right:
        canvas.text(
            (layout.content_right - 2, y),
            right,
            size=FOOTER_SIZE,
            color=theme.text_dim,
            anchor="rs",
        )


def _source_note(snapshot: PlayerSnapshot) -> str:
    """Describe the freshness of a snapshot for the footer."""

    age = relative_age(snapshot.age_seconds)
    if snapshot.source == "live":
        return "Fetched from the Hypixel API just now"
    if snapshot.source == "cache":
        return f"Served from cache - updated {age}"
    return f"Hypixel unreachable - showing cached data from {age}"


def _progress_bar(
    canvas: Canvas,
    box: Sequence[float],
    fraction: float,
    color: str,
    track: str | None = None,
) -> None:
    """Draw a rounded progress bar filled to ``fraction`` of its width."""

    x0, y0, x1, y1 = box
    height = y1 - y0
    canvas.rounded_rect(box, height / 2, fill=track or canvas.theme.panel_alt)
    clamped = max(0.0, min(fraction, 1.0))
    if clamped <= 0:
        return
    # Keep short bars visible: never draw narrower than the cap diameter.
    filled = max((x1 - x0) * clamped, height)
    canvas.rounded_rect((x0, y0, x0 + filled, y1), height / 2, fill=color)


def _overall_tiles(stats: ZombiesStats, theme: Theme) -> list[Tile]:
    overall = stats.overall
    return [
        Tile("Zombie Kills", thousands(overall.zombie_kills)),
        Tile("Wins", thousands(overall.wins), color=theme.accent),
        Tile("Best Round", thousands(overall.best_round)),
        Tile("Rounds Survived", thousands(overall.rounds_survived)),
        Tile("Kill/Death", ratio(overall.kill_death_ratio)),
        Tile("Accuracy", percent(overall.accuracy)),
        Tile("Headshots", percent(overall.headshot_rate), hint="of hits"),
        Tile("Players Revived", thousands(overall.players_revived)),
    ]


def render_overview_card(snapshot: PlayerSnapshot, theme: Theme) -> bytes:
    """The ``stats`` card: overall totals plus a per-map summary."""

    layout = Layout()
    stats = snapshot.stats
    played = stats.maps_played()

    height = (
        layout.margin
        + layout.header_height
        + layout.tile_gap
        + 6
        + 2 * (layout.tile_height + layout.tile_gap)
        + 22
        + max(len(played), 1) * 40
        + 16
        + layout.footer_height
    )
    canvas = Canvas(layout.width, int(height), theme)

    completed = stats.maps_completed
    badge = f"{completed}/3 MAPS BEATEN" if completed else None

    y = _draw_header(
        canvas,
        layout,
        snapshot.rank,
        snapshot.name,
        "Hypixel Zombies - Overall",
        theme.accent,
        badge=badge,
    )
    y = _draw_tiles(canvas, layout, _overall_tiles(stats, theme), y)
    y = _draw_section_title(canvas, layout, "By map", y)

    if played:
        best_kills = max(m.combat.zombie_kills for m in played) or 1
        for map_stats in played:
            _draw_map_row(canvas, layout, map_stats, y, best_kills)
            y += 40
    else:
        canvas.text(
            (layout.content_left + 2, y + 6),
            "No per-map data recorded yet.",
            size=TABLE_SIZE,
            color=theme.text_muted,
            anchor="la",
        )

    _draw_footer(canvas, layout, _source_note(snapshot), "Round105")
    return _to_png(canvas)


def _draw_map_row(
    canvas: Canvas,
    layout: Layout,
    map_stats: MapStats,
    y: float,
    best_kills: int,
) -> None:
    """One row of the overview's per-map summary."""

    theme = canvas.theme
    zombies_map = map_stats.map
    combat = map_stats.combat
    row_h = 32

    canvas.rounded_rect(
        (layout.content_left, y, layout.content_right, y + row_h),
        8,
        fill=theme.panel,
    )
    canvas.rounded_rect(
        (layout.content_left, y, layout.content_left + 4, y + row_h),
        2,
        fill=zombies_map.accent,
    )

    mid = y + row_h / 2
    canvas.text(
        (layout.content_left + 18, mid),
        zombies_map.label,
        weight="bold",
        size=TABLE_SIZE,
        color=theme.text,
        anchor="lm",
    )

    # Kill share bar, sized against the player's strongest map.
    bar_left = layout.content_left + 170
    bar_right = bar_left + 190
    _progress_bar(
        canvas,
        (bar_left, mid - 4, bar_right, mid + 4),
        combat.zombie_kills / best_kills,
        zombies_map.accent,
    )

    canvas.text(
        (bar_right + 16, mid),
        f"{compact(combat.zombie_kills)} kills",
        size=TABLE_SIZE,
        color=theme.text_muted,
        anchor="lm",
    )

    best_round_label = f"Best round {thousands(combat.best_round)}"
    canvas.text(
        (layout.content_right - 120, mid),
        best_round_label,
        size=TABLE_SIZE,
        color=theme.text_muted,
        anchor="rm",
    )

    if zombies_map.is_endless:
        # Endless maps have no win condition, so "no wins" would mislead.
        wins_color, wins_text = theme.text_dim, "endless"
    elif map_stats.completed:
        wins_color, wins_text = theme.positive, f"{thousands(combat.wins)} wins"
    else:
        wins_color, wins_text = theme.text_dim, "no wins"
    canvas.text(
        (layout.content_right - 16, mid),
        wins_text,
        weight="bold",
        size=TABLE_SIZE,
        color=wins_color,
        anchor="rm",
    )


def render_map_card(
    snapshot: PlayerSnapshot, zombies_map: ZombiesMap, theme: Theme
) -> bytes:
    """A per-map card: map totals plus a per-difficulty breakdown."""

    layout = Layout()
    map_stats = snapshot.stats.map_stats(zombies_map)
    combat = map_stats.combat
    difficulties = map_stats.played_difficulties()

    if zombies_map.is_endless:
        detail_height = 100
    elif difficulties:
        detail_height = 30 + len(difficulties) * 30 + 10
    else:
        detail_height = 40

    height = (
        layout.margin
        + layout.header_height
        + layout.tile_gap
        + 6
        + 2 * (layout.tile_height + layout.tile_gap)
        + 22
        + detail_height
        + layout.footer_height
    )
    canvas = Canvas(layout.width, int(height), theme)

    if map_stats.completed:
        badge = "COMPLETED"
    elif combat.has_data:
        badge = f"BEST ROUND {combat.best_round}"
    else:
        badge = None

    y = _draw_header(
        canvas,
        layout,
        snapshot.rank,
        snapshot.name,
        f"Hypixel Zombies - {zombies_map.label}",
        zombies_map.accent,
        badge=badge,
    )

    # An endless map cannot be won, so that tile would always read zero.
    if zombies_map.is_endless:
        second_tile = Tile("Kills/Round", ratio(combat.kills_per_round))
    else:
        second_tile = Tile(
            "Wins", thousands(combat.wins), color=zombies_map.accent
        )

    tiles = [
        Tile("Zombie Kills", thousands(combat.zombie_kills)),
        second_tile,
        Tile("Best Round", thousands(combat.best_round)),
        Tile("Rounds Survived", thousands(combat.rounds_survived)),
        Tile("Kill/Death", ratio(combat.kill_death_ratio)),
        Tile("Accuracy", percent(combat.accuracy)),
        Tile("Doors Opened", thousands(combat.doors_opened)),
        Tile("Windows Repaired", thousands(combat.windows_repaired)),
    ]
    y = _draw_tiles(canvas, layout, tiles, y)

    if not combat.has_data:
        y = _draw_section_title(canvas, layout, "Difficulties", y)
        canvas.text(
            (layout.content_left + 2, y + 4),
            f"No {zombies_map.label} games recorded.",
            size=TABLE_SIZE,
            color=theme.text_muted,
            anchor="la",
        )
    elif zombies_map.is_endless:
        _draw_endless_progress(canvas, layout, map_stats, y)
    else:
        y = _draw_section_title(canvas, layout, "By difficulty", y)
        _draw_difficulty_table(canvas, layout, map_stats, y)

    _draw_footer(canvas, layout, _source_note(snapshot), "Round105")
    return _to_png(canvas)


#: Rounds past which Alien Arcadium is considered maxed by the community.
ENDLESS_TARGET_ROUND = 105


def _draw_endless_progress(
    canvas: Canvas, layout: Layout, map_stats: MapStats, y: float
) -> None:
    """Alien Arcadium has no difficulties, so show round progress instead."""

    theme = canvas.theme
    combat = map_stats.combat
    accent = map_stats.map.accent

    y = _draw_section_title(canvas, layout, "Round progress", y)

    canvas.text(
        (layout.content_left + 2, y + 16),
        f"Round {thousands(combat.best_round)}",
        weight="bold",
        size=VALUE_SIZE,
        color=theme.text,
        anchor="ls",
    )
    canvas.text(
        (layout.content_right - 2, y + 16),
        f"of {ENDLESS_TARGET_ROUND}",
        size=TABLE_SIZE,
        color=theme.text_muted,
        anchor="rs",
    )

    _progress_bar(
        canvas,
        (layout.content_left, y + 28, layout.content_right, y + 42),
        combat.best_round / ENDLESS_TARGET_ROUND,
        accent,
    )

    remaining = ENDLESS_TARGET_ROUND - combat.best_round
    if remaining <= 0:
        progress_note = f"Round {ENDLESS_TARGET_ROUND} reached"
    else:
        plural = "" if remaining == 1 else "s"
        progress_note = f"{remaining} round{plural} from {ENDLESS_TARGET_ROUND}"

    canvas.text(
        (layout.content_left + 2, y + 62),
        f"{thousands(combat.players_revived)} revives  -  {progress_note}",
        size=TABLE_SIZE,
        color=theme.text_muted,
        anchor="la",
    )


def _draw_difficulty_table(
    canvas: Canvas, layout: Layout, map_stats: MapStats, y: float
) -> None:
    """Wins, best round, and fastest clear times per difficulty."""

    theme = canvas.theme
    accent = map_stats.map.accent
    rows = map_stats.played_difficulties()

    # The first column needs no header; the section title already names it.
    columns: tuple[tuple[str, float, str], ...] = (
        ("", 0.24, "left"),
        ("Wins", 0.12, "right"),
        ("Best Round", 0.16, "right"),
        ("Fastest 10", 0.16, "right"),
        ("Fastest 20", 0.16, "right"),
        ("Fastest 30", 0.16, "right"),
    )

    def column_x(index: int) -> tuple[float, float]:
        offset = layout.content_left + 14
        for position, (_header, share, _align) in enumerate(columns):
            width = share * (layout.content_width - 28)
            if position == index:
                return offset, offset + width
            offset += width
        return offset, offset

    for index, (header, _share, align) in enumerate(columns):
        left, right = column_x(index)
        x = left if align == "left" else right
        canvas.text(
            (x, y),
            header.upper(),
            weight="bold",
            size=HINT_SIZE,
            color=theme.text_dim,
            anchor="la" if align == "left" else "ra",
        )

    y += 20
    for row_index, stats in enumerate(rows):
        row_top = y + row_index * 30
        if row_index % 2 == 0:
            canvas.rounded_rect(
                (layout.content_left, row_top, layout.content_right, row_top + 28),
                6,
                fill=theme.panel,
            )
        mid = row_top + 14

        values = (
            stats.difficulty.label,
            thousands(stats.wins),
            thousands(stats.best_round),
            duration(stats.fastest_time(10)),
            duration(stats.fastest_time(20)),
            duration(stats.fastest_time(30)),
        )
        for index, (value, (_header, _share, align)) in enumerate(
            zip(values, columns)
        ):
            left, right = column_x(index)
            x = left if align == "left" else right
            if index == 0:
                color = theme.text
                weight = "bold"
            elif index == 1 and stats.wins > 0:
                color = accent
                weight = "bold"
            elif value == "--":
                color = theme.text_dim
                weight = "regular"
            else:
                color = theme.text_muted
                weight = "regular"
            canvas.text(
                (x, mid),
                value,
                weight=weight,
                size=TABLE_SIZE,
                color=color,
                anchor="lm" if align == "left" else "rm",
            )


def render_kills_card(snapshot: PlayerSnapshot, theme: Theme) -> bytes:
    """The ``kills`` card: combat efficiency and a per-map kill breakdown."""

    layout = Layout()
    stats = snapshot.stats
    overall = stats.overall
    played = stats.maps_played()

    height = (
        layout.margin
        + layout.header_height
        + layout.tile_gap
        + 6
        + layout.tile_height
        + layout.tile_gap
        + 22
        + 74
        + 22
        + max(len(played), 1) * 34
        + 10
        + layout.footer_height
    )
    canvas = Canvas(layout.width, int(height), theme)

    y = _draw_header(
        canvas,
        layout,
        snapshot.rank,
        snapshot.name,
        "Hypixel Zombies - Combat",
        theme.accent,
        badge=f"{compact(overall.zombie_kills)} KILLS"
        if overall.zombie_kills
        else None,
    )

    tiles = [
        Tile("Zombie Kills", thousands(overall.zombie_kills)),
        Tile("Deaths", thousands(overall.deaths)),
        Tile("Kill/Death", ratio(overall.kill_death_ratio)),
        Tile("Kills/Round", ratio(overall.kills_per_round)),
    ]
    y = _draw_tiles(canvas, layout, tiles, y)

    y = _draw_section_title(canvas, layout, "Shooting", y)
    _draw_shooting_panel(canvas, layout, snapshot, y)
    y += 74

    y = _draw_section_title(canvas, layout, "Kills by map", y)
    if played:
        best = max(m.combat.zombie_kills for m in played) or 1
        for map_stats in played:
            _draw_kill_bar(canvas, layout, map_stats, y, best)
            y += 34
    else:
        canvas.text(
            (layout.content_left + 2, y + 4),
            "No kills recorded yet.",
            size=TABLE_SIZE,
            color=theme.text_muted,
            anchor="la",
        )

    _draw_footer(canvas, layout, _source_note(snapshot), "Round105")
    return _to_png(canvas)


def _draw_shooting_panel(
    canvas: Canvas, layout: Layout, snapshot: PlayerSnapshot, y: float
) -> None:
    """Accuracy and headshot bars with their underlying bullet counts."""

    theme = canvas.theme
    overall = snapshot.stats.overall
    panel_h = 66

    canvas.rounded_rect(
        (layout.content_left, y, layout.content_right, y + panel_h),
        10,
        fill=theme.panel,
    )

    bars = (
        ("Accuracy", overall.accuracy, theme.accent,
         f"{compact(overall.bullets_hit)} / {compact(overall.bullets_shot)} bullets"),
        ("Headshots", overall.headshot_rate, theme.warning,
         f"{compact(overall.headshots)} headshots"),
    )

    for index, (label, fraction, color, note) in enumerate(bars):
        row_y = y + 20 + index * 26
        canvas.text(
            (layout.content_left + 16, row_y),
            label,
            weight="bold",
            size=HINT_SIZE,
            color=theme.text_dim,
            anchor="lm",
        )
        bar_left = layout.content_left + 100
        bar_right = layout.content_right - 285
        _progress_bar(
            canvas,
            (bar_left, row_y - 5, bar_right, row_y + 5),
            fraction,
            color,
            track=theme.panel_alt,
        )
        canvas.text(
            (bar_right + 14, row_y),
            percent(fraction),
            weight="bold",
            size=TABLE_SIZE,
            color=theme.text,
            anchor="lm",
        )
        canvas.text(
            (layout.content_right - 16, row_y),
            note,
            size=HINT_SIZE,
            color=theme.text_dim,
            anchor="rm",
        )


def _draw_kill_bar(
    canvas: Canvas, layout: Layout, map_stats: MapStats, y: float, best: int
) -> None:
    theme = canvas.theme
    combat = map_stats.combat
    mid = y + 13

    canvas.text(
        (layout.content_left + 2, mid),
        map_stats.map.label,
        size=TABLE_SIZE,
        color=theme.text,
        anchor="lm",
    )

    bar_left = layout.content_left + 160
    bar_right = layout.content_right - 150
    _progress_bar(
        canvas,
        (bar_left, mid - 7, bar_right, mid + 7),
        combat.zombie_kills / best,
        map_stats.map.accent,
    )

    canvas.text(
        (layout.content_right - 2, mid),
        f"{thousands(combat.zombie_kills)}  ({ratio(combat.kills_per_round)}/rd)",
        size=TABLE_SIZE,
        color=theme.text_muted,
        anchor="rm",
    )


def render_leaderboard_card(
    leaderboard: Leaderboard, theme: Theme, scope_note: str
) -> bytes:
    """The ``rankings`` card: cached players ranked by one metric."""

    layout = Layout()
    entries = leaderboard.entries
    row_h = 36

    height = (
        layout.margin
        + 76
        + 14
        + max(len(entries), 1) * row_h
        + 14
        + layout.footer_height
    )
    canvas = Canvas(layout.width, int(height), theme)

    top = layout.margin
    canvas.rounded_rect(
        (layout.content_left, top, layout.content_right, top + 76),
        layout.radius,
        fill=theme.panel,
    )
    canvas.rounded_rect(
        (layout.content_left, top, layout.content_left + 6, top + 76),
        3,
        fill=theme.accent,
    )
    canvas.text(
        (layout.content_left + 24, top + 34),
        f"Top {leaderboard.metric.label}",
        weight="bold",
        size=28,
        color=theme.text,
        anchor="ls",
    )
    canvas.text(
        (layout.content_left + 24, top + 44),
        scope_note,
        size=13,
        color=theme.text_muted,
        anchor="la",
    )

    y = top + 76 + 14

    if not entries:
        canvas.text(
            (layout.content_left + 2, y + 8),
            "No cached players have Zombies data yet. Run a stats lookup first.",
            size=TABLE_SIZE,
            color=theme.text_muted,
            anchor="la",
        )
    else:
        best = max(entry.value for entry in entries) or 1.0
        for entry in entries:
            _draw_leaderboard_row(canvas, layout, entry, y, best, row_h)
            y += row_h

    _draw_footer(
        canvas,
        layout,
        f"Ranked from {leaderboard.players_ranked} cached players "
        f"({leaderboard.players_cached} tracked) - no API crawl",
        "Round105",
    )
    return _to_png(canvas)


def _draw_leaderboard_row(
    canvas: Canvas,
    layout: Layout,
    entry,
    y: float,
    best: float,
    row_h: float,
) -> None:
    theme = canvas.theme
    inner_h = row_h - 6
    canvas.rounded_rect(
        (layout.content_left, y, layout.content_right, y + inner_h),
        8,
        fill=theme.panel,
    )

    if entry.position <= 3:
        position_color = theme.podium[entry.position - 1]
    else:
        position_color = theme.text_dim
    canvas.rounded_rect(
        (layout.content_left, y, layout.content_left + 4, y + inner_h),
        2,
        fill=position_color,
    )

    mid = y + inner_h / 2
    canvas.text(
        (layout.content_left + 40, mid),
        f"#{entry.position}",
        weight="bold",
        size=TABLE_SIZE,
        color=position_color,
        anchor="rm",
    )

    bar_left = layout.content_left + 330
    bar_right = layout.content_right - 170

    _draw_name_plate(
        canvas,
        (layout.content_left + 56, mid + 5),
        entry.rank,
        entry.name,
        size=TABLE_SIZE,
        right_limit=bar_left - 16,
        gap=7,
    )

    # Podium rows keep their medal colour; the rest share a muted bar so first
    # place stays visually distinct from fourth.
    _progress_bar(
        canvas,
        (bar_left, mid - 5, bar_right, mid + 5),
        entry.value / best,
        position_color if entry.position <= 3 else theme.bar_muted,
        track=theme.panel_alt,
    )

    canvas.text(
        (layout.content_right - 80, mid),
        entry.display_value,
        weight="bold",
        size=TABLE_SIZE,
        color=theme.text,
        anchor="rm",
    )
    canvas.text(
        (layout.content_right - 14, mid),
        relative_age(entry.age_seconds),
        size=HINT_SIZE,
        color=theme.text_dim,
        anchor="rm",
    )
