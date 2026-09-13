"""Tests for display formatting."""

from __future__ import annotations

import pytest

from round105.formatting import (
    compact,
    duration,
    percent,
    ratio,
    relative_age,
    thousands,
)


@pytest.mark.parametrize(
    ("value", "expected"),
    [(0, "0"), (999, "999"), (1_000, "1K"), (1_234, "1.23K"), (1_500_000, "1.5M"),
     (2_000_000_000, "2B"), (-4_500, "-4.5K")],
)
def test_compact(value, expected):
    assert compact(value) == expected


def test_thousands():
    assert thousands(1_234_567) == "1,234,567"
    assert thousands(0) == "0"


def test_ratio_and_percent():
    assert ratio(1.5) == "1.50"
    assert percent(0.6142) == "61.4%"
    assert percent(0.6142, decimals=2) == "61.42%"
    assert percent(0) == "0.0%"


@pytest.mark.parametrize(
    ("seconds", "expected"),
    [(None, "--"), (0, "--"), (-5, "--"), (59, "0:59"), (61, "1:01"),
     (1_623, "27:03"), (3_600, "1:00:00"), (3_725, "1:02:05")],
)
def test_duration(seconds, expected):
    assert duration(seconds) == expected


@pytest.mark.parametrize(
    ("seconds", "expected"),
    [(0, "just now"), (9, "just now"), (30, "30s ago"), (90, "1m ago"),
     (300, "5m ago"), (7_200, "2h ago"), (172_800, "2d ago")],
)
def test_relative_age(seconds, expected):
    assert relative_age(seconds) == expected
