"""Colours, fonts, and the drawing surface used by the stat cards."""

from __future__ import annotations

from dataclasses import dataclass, field
from functools import lru_cache
from typing import Iterable, Sequence

from PIL import Image, ImageDraw, ImageFont

#: Cards are drawn at this multiple of their logical size and then downsampled,
#: which smooths the edges of rounded panels and bars.
SUPERSAMPLE = 2


@lru_cache(maxsize=64)
def _load_font(path: str | None, size: int) -> ImageFont.FreeTypeFont:
    """Load a font, falling back to Pillow's bundled face if the path fails."""

    if path:
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            pass
    return ImageFont.load_default(size=size)


@dataclass(frozen=True)
class Theme:
    """Visual configuration for the cards."""

    font_regular: str | None = None
    font_bold: str | None = None

    background: str = "#121419"
    panel: str = "#1b1e26"
    panel_alt: str = "#22262f"
    border: str = "#2c313d"
    text: str = "#f2f4f8"
    text_muted: str = "#8b93a5"
    text_dim: str = "#5f677a"
    accent: str = "#e0a33e"
    warning: str = "#d9822b"
    positive: str = "#4f9d5d"
    #: Bars that should read as secondary, such as non-podium leaderboard rows.
    bar_muted: str = "#6b7689"
    #: Colours for first, second, and third place on a leaderboard.
    podium: tuple[str, str, str] = ("#e0a33e", "#b9bfcc", "#b0763a")

    def font(self, weight: str, size: int) -> ImageFont.FreeTypeFont:
        path = self.font_bold if weight == "bold" else self.font_regular
        return _load_font(path, size)


class Canvas:
    """A drawing surface that accepts logical coordinates.

    Every coordinate and font size passed in is multiplied by
    :data:`SUPERSAMPLE`; :meth:`to_image` downsamples back to the logical size.
    Callers can therefore lay cards out in comfortable pixel units and still get
    smooth output.
    """

    def __init__(
        self,
        width: int,
        height: int,
        theme: Theme,
        scale: int = SUPERSAMPLE,
        background: str | None = None,
    ) -> None:
        self.width = width
        self.height = height
        self.theme = theme
        self.scale = scale
        self._image = Image.new(
            "RGB", (width * scale, height * scale), background or theme.background
        )
        self._draw = ImageDraw.Draw(self._image)

    def _box(self, box: Sequence[float]) -> tuple[float, float, float, float]:
        x0, y0, x1, y1 = box
        s = self.scale
        return (x0 * s, y0 * s, x1 * s, y1 * s)

    def _font(self, weight: str, size: int) -> ImageFont.FreeTypeFont:
        return self.theme.font(weight, int(size * self.scale))

    def rect(self, box: Sequence[float], fill: str) -> None:
        self._draw.rectangle(self._box(box), fill=fill)

    def rounded_rect(
        self,
        box: Sequence[float],
        radius: float,
        fill: str | None = None,
        outline: str | None = None,
        width: float = 1,
    ) -> None:
        self._draw.rounded_rectangle(
            self._box(box),
            radius=radius * self.scale,
            fill=fill,
            outline=outline,
            width=max(int(width * self.scale), 1) if outline else 1,
        )

    def text(
        self,
        xy: tuple[float, float],
        content: str,
        *,
        weight: str = "regular",
        size: int = 16,
        color: str | None = None,
        anchor: str = "la",
    ) -> None:
        x, y = xy
        self._draw.text(
            (x * self.scale, y * self.scale),
            content,
            font=self._font(weight, size),
            fill=color or self.theme.text,
            anchor=anchor,
        )

    def text_width(self, content: str, *, weight: str = "regular", size: int = 16) -> float:
        """Width of ``content`` in logical pixels."""

        return self._draw.textlength(content, font=self._font(weight, size)) / self.scale

    def text_runs(
        self,
        xy: tuple[float, float],
        runs: Iterable[tuple[str, str]],
        *,
        weight: str = "regular",
        size: int = 16,
        anchor: str = "ls",
        gap: float = 0.0,
    ) -> float:
        """Draw coloured runs of text side by side, returning the end x position.

        Used for rank tags, where the ``+`` characters take a different colour
        from the rest of the tag.
        """

        x, y = xy
        for content, color in runs:
            if not content:
                continue
            self.text((x, y), content, weight=weight, size=size, color=color, anchor=anchor)
            x += self.text_width(content, weight=weight, size=size) + gap
        return x

    def truncate(
        self, content: str, max_width: float, *, weight: str = "regular", size: int = 16
    ) -> str:
        """Shorten ``content`` with an ellipsis until it fits ``max_width``."""

        if self.text_width(content, weight=weight, size=size) <= max_width:
            return content
        ellipsis = "..."
        trimmed = content
        while trimmed and self.text_width(
            trimmed + ellipsis, weight=weight, size=size
        ) > max_width:
            trimmed = trimmed[:-1]
        return (trimmed + ellipsis) if trimmed else ellipsis

    def to_image(self) -> Image.Image:
        if self.scale == 1:
            return self._image
        return self._image.resize((self.width, self.height), Image.LANCZOS)


@dataclass
class Layout:
    """Card geometry shared by every card type."""

    width: int = 900
    margin: int = 28
    header_height: int = 96
    footer_height: int = 34
    tile_height: int = 74
    tile_gap: int = 12
    radius: int = 14

    @property
    def content_width(self) -> int:
        return self.width - 2 * self.margin

    @property
    def content_left(self) -> int:
        return self.margin

    @property
    def content_right(self) -> int:
        return self.width - self.margin


@dataclass(frozen=True)
class Tile:
    """A single labelled stat in a card's grid."""

    label: str
    value: str
    color: str | None = None
    hint: str | None = None


@dataclass
class Column:
    """A column definition for the table helper."""

    header: str
    width: float
    align: str = "left"
    values: list[str] = field(default_factory=list)
