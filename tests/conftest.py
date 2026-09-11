"""Shared fixtures and test doubles."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from round105.zombies import parse_zombies_stats

DATA_DIR = Path(__file__).parent / "data"

SAMPLE_UUID = "b3f1a2c47d8e4f0a9b6c5d4e3f2a1b09"
SAMPLE_NAME = "RoundRunner"


@pytest.fixture
def sample_player() -> dict[str, Any]:
    return json.loads((DATA_DIR / "sample_player.json").read_text())


@pytest.fixture
def sample_stats(sample_player):
    return parse_zombies_stats(sample_player)
