"""Number, duration, and age formatting shared by the cards and embeds."""

from __future__ import annotations

_COMPACT_UNITS: tuple[tuple[int, str], ...] = (
    (1_000_000_000, "B"),
    (1_000_000, "M"),
    (1_000, "K"),
)


def thousands(value: float | int) -> str:
    """``1234567`` -> ``"1,234,567"``."""

    return f"{int(value):,}"


def compact(value: float | int) -> str:
    """``1234567`` -> ``"1.23M"``, for values that must fit a narrow tile."""

    number = int(value)
    negative = number < 0
    number = abs(number)
    for threshold, suffix in _COMPACT_UNITS:
        if number >= threshold:
            scaled = number / threshold
            text = f"{scaled:.2f}".rstrip("0").rstrip(".")
            return f"{'-' if negative else ''}{text}{suffix}"
    return f"{'-' if negative else ''}{number:,}"


def ratio(value: float) -> str:
    return f"{value:.2f}"


def percent(value: float, decimals: int = 1) -> str:
    """Format a ``0.0``-``1.0`` fraction as a percentage."""

    return f"{value * 100:.{decimals}f}%"


def duration(seconds: float | int | None) -> str:
    """Format a run time as ``m:ss``, or ``h:mm:ss`` past an hour."""

    if seconds is None or seconds <= 0:
        return "--"
    total = int(seconds)
    hours, remainder = divmod(total, 3600)
    minutes, secs = divmod(remainder, 60)
    if hours:
        return f"{hours}:{minutes:02d}:{secs:02d}"
    return f"{minutes}:{secs:02d}"


def relative_age(seconds: float) -> str:
    """Describe how long ago something was fetched, for the card footer."""

    if seconds < 10:
        return "just now"
    if seconds < 60:
        return f"{int(seconds)}s ago"
    if seconds < 3600:
        return f"{int(seconds // 60)}m ago"
    if seconds < 86_400:
        hours = int(seconds // 3600)
        return f"{hours}h ago"
    days = int(seconds // 86_400)
    return f"{days}d ago"
