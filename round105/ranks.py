"""Hypixel rank resolution and Minecraft colour codes.

Hypixel spreads rank information across several fields that have accumulated over
the years, and the correct answer is whichever of them is set, in a specific
order of precedence. :func:`resolve_rank` encodes that order.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Mapping

#: Minecraft's legacy colour codes mapped to hex.
COLOR_CODES: dict[str, str] = {
    "0": "#000000",
    "1": "#0000aa",
    "2": "#00aa00",
    "3": "#00aaaa",
    "4": "#aa0000",
    "5": "#aa00aa",
    "6": "#ffaa00",
    "7": "#aaaaaa",
    "8": "#555555",
    "9": "#5555ff",
    "a": "#55ff55",
    "b": "#55ffff",
    "c": "#ff5555",
    "d": "#ff55ff",
    "e": "#ffff55",
    "f": "#ffffff",
}

#: Hypixel reports plus-sign and monthly rank colours by name, not code.
NAMED_COLORS: dict[str, str] = {
    "BLACK": "#000000",
    "DARK_BLUE": "#0000aa",
    "DARK_GREEN": "#00aa00",
    "DARK_AQUA": "#00aaaa",
    "DARK_RED": "#aa0000",
    "DARK_PURPLE": "#aa00aa",
    "GOLD": "#ffaa00",
    "GRAY": "#aaaaaa",
    "GREY": "#aaaaaa",
    "DARK_GRAY": "#555555",
    "DARK_GREY": "#555555",
    "BLUE": "#5555ff",
    "GREEN": "#55ff55",
    "AQUA": "#55ffff",
    "RED": "#ff5555",
    "LIGHT_PURPLE": "#ff55ff",
    "YELLOW": "#ffff55",
    "WHITE": "#ffffff",
}

DEFAULT_COLOR = "#aaaaaa"

_COLOR_CODE_RE = re.compile(r"[§&][0-9a-fk-or]", re.IGNORECASE)
_FIRST_CODE_RE = re.compile(r"[§&]([0-9a-f])", re.IGNORECASE)


def strip_color_codes(text: str) -> str:
    """Remove Minecraft formatting codes from ``text``."""

    return _COLOR_CODE_RE.sub("", text)


def named_color(name: Any, default: str = DEFAULT_COLOR) -> str:
    """Resolve a Hypixel colour name such as ``"AQUA"`` to a hex string."""

    if isinstance(name, str):
        return NAMED_COLORS.get(name.strip().upper(), default)
    return default


@dataclass(frozen=True)
class Rank:
    """A rank ready to be drawn: bracketed tag plus the colours it uses."""

    #: Bracketed tag such as ``[MVP++]``, or empty for the default rank.
    tag: str
    #: Primary colour of the tag.
    color: str = DEFAULT_COLOR
    #: Colour of the ``+`` characters, when they differ from the tag colour.
    plus_color: str | None = None
    #: How many trailing ``+`` characters take ``plus_color``.
    plus_count: int = 0
    #: Explicit ``(text, colour)`` runs, for tags whose colouring does not follow
    #: the plus-sign pattern. Overrides :attr:`plus_color` when set.
    tag_segments: tuple[tuple[str, str], ...] | None = None

    @property
    def has_tag(self) -> bool:
        return bool(self.tag)

    def name_color(self) -> str:
        """Colour a player's username should be drawn in."""

        return self.color if self.has_tag else DEFAULT_COLOR

    def segments(self) -> list[tuple[str, str]]:
        """Split the tag into ``(text, colour)`` runs for coloured drawing."""

        if not self.has_tag:
            return []
        if self.tag_segments is not None:
            return list(self.tag_segments)
        if not self.plus_count or not self.plus_color:
            return [(self.tag, self.color)]

        # Split "[MVP++]" into "[MVP", "++", "]" so the pluses can be recoloured.
        closing = "]" if self.tag.endswith("]") else ""
        body = self.tag[: -len(closing)] if closing else self.tag
        pluses = "+" * self.plus_count
        if not body.endswith(pluses):
            return [(self.tag, self.color)]
        head = body[: -self.plus_count]
        segments = [(head, self.color), (pluses, self.plus_color)]
        if closing:
            segments.append((closing, self.color))
        return segments


DEFAULT_RANK = Rank(tag="", color=DEFAULT_COLOR)

#: Staff and special ranks, keyed by the value of ``player.rank``.
_STAFF_RANKS: dict[str, Rank] = {
    "ADMIN": Rank("[ADMIN]", COLOR_CODES["c"]),
    "OWNER": Rank("[OWNER]", COLOR_CODES["c"]),
    "GAME_MASTER": Rank("[GM]", COLOR_CODES["2"]),
    "MODERATOR": Rank("[MOD]", COLOR_CODES["2"]),
    "HELPER": Rank("[HELPER]", COLOR_CODES["9"]),
    # The YouTube rank is the one tag with white text inside red brackets.
    "YOUTUBER": Rank(
        "[YOUTUBE]",
        COLOR_CODES["c"],
        tag_segments=(
            ("[", COLOR_CODES["c"]),
            ("YOUTUBE", COLOR_CODES["f"]),
            ("]", COLOR_CODES["c"]),
        ),
    ),
}

#: Purchasable ranks, keyed by ``newPackageRank`` / ``packageRank``.
_PACKAGE_RANKS: dict[str, Rank] = {
    "VIP": Rank("[VIP]", COLOR_CODES["a"]),
    "VIP_PLUS": Rank("[VIP+]", COLOR_CODES["a"], COLOR_CODES["6"], 1),
    "MVP": Rank("[MVP]", COLOR_CODES["b"]),
    "MVP_PLUS": Rank("[MVP+]", COLOR_CODES["b"], COLOR_CODES["c"], 1),
}


def _rank_field(player: Mapping[str, Any], key: str) -> str | None:
    """Read a rank field, normalising Hypixel's "unset" placeholders to ``None``."""

    value = player.get(key)
    if not isinstance(value, str):
        return None
    normalised = value.strip().upper()
    if not normalised or normalised in {"NONE", "NORMAL", "UNKNOWN", "DEFAULT"}:
        return None
    return normalised


def resolve_rank(player: Mapping[str, Any] | None) -> Rank:
    """Determine a player's displayed rank.

    Precedence follows Hypixel's own display logic: a custom ``prefix`` overrides
    everything, then staff ranks, then MVP++ (a monthly subscription tracked
    separately from the one-time package ranks), then package ranks.
    """

    if not player:
        return DEFAULT_RANK

    prefix = player.get("prefix")
    if isinstance(prefix, str) and prefix.strip():
        tag = strip_color_codes(prefix).strip()
        if tag:
            match = _FIRST_CODE_RE.search(prefix)
            color = COLOR_CODES[match.group(1).lower()] if match else DEFAULT_COLOR
            return Rank(tag=tag, color=color)

    staff = _rank_field(player, "rank")
    if staff and staff in _STAFF_RANKS:
        return _STAFF_RANKS[staff]

    if _rank_field(player, "monthlyPackageRank") == "SUPERSTAR":
        # MVP++ keeps its own colour setting, defaulting to gold.
        return Rank(
            tag="[MVP++]",
            color=named_color(player.get("monthlyRankColor"), COLOR_CODES["6"]),
            plus_color=named_color(player.get("rankPlusColor"), COLOR_CODES["c"]),
            plus_count=2,
        )

    package = _rank_field(player, "newPackageRank") or _rank_field(
        player, "packageRank"
    )
    if package and package in _PACKAGE_RANKS:
        rank = _PACKAGE_RANKS[package]
        if rank.plus_count:
            # MVP+ and VIP+ owners can recolour the plus sign.
            return Rank(
                tag=rank.tag,
                color=rank.color,
                plus_color=named_color(player.get("rankPlusColor"), rank.plus_color),
                plus_count=rank.plus_count,
            )
        return rank

    return DEFAULT_RANK
