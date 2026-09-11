"""Tests for environment configuration."""

from __future__ import annotations

from pathlib import Path

import pytest

from round105.config import Config
from round105.errors import ConfigError

REQUIRED = {"DISCORD_TOKEN": "token-value", "HYPIXEL_API_KEY": "key-value"}

OPTIONAL = (
    "COMMAND_PREFIX",
    "ENABLE_PREFIX_COMMANDS",
    "DEV_GUILD_ID",
    "CACHE_TTL_SECONDS",
    "NAME_TTL_SECONDS",
    "CACHE_PATH",
    "LEADERBOARD_SIZE",
    "REQUEST_TIMEOUT_SECONDS",
    "FONT_REGULAR",
    "FONT_BOLD",
)


@pytest.fixture
def clean_env(monkeypatch):
    """Start from an environment with none of the bot's variables set."""

    for name in (*REQUIRED, *OPTIONAL):
        monkeypatch.delenv(name, raising=False)
    return monkeypatch


def test_missing_token_raises(clean_env):
    clean_env.setenv("HYPIXEL_API_KEY", "key-value")

    with pytest.raises(ConfigError, match="DISCORD_TOKEN"):
        Config.from_env()


def test_missing_api_key_raises(clean_env):
    clean_env.setenv("DISCORD_TOKEN", "token-value")

    with pytest.raises(ConfigError, match="HYPIXEL_API_KEY"):
        Config.from_env()


def test_blank_token_is_treated_as_missing(clean_env):
    clean_env.setenv("DISCORD_TOKEN", "   ")
    clean_env.setenv("HYPIXEL_API_KEY", "key-value")

    with pytest.raises(ConfigError):
        Config.from_env()


def test_defaults(clean_env):
    for name, value in REQUIRED.items():
        clean_env.setenv(name, value)

    config = Config.from_env()

    assert config.discord_token == "token-value"
    assert config.hypixel_api_key == "key-value"
    assert config.command_prefix == "z!"
    assert config.cache_ttl_seconds == 300
    assert config.name_ttl_seconds == 86_400
    assert config.cache_path == Path("data/cache.sqlite3")
    assert config.leaderboard_size == 10
    assert config.request_timeout_seconds == 10
    assert config.dev_guild_id is None
    assert config.enable_prefix_commands is False


def test_overrides(clean_env):
    for name, value in REQUIRED.items():
        clean_env.setenv(name, value)
    clean_env.setenv("COMMAND_PREFIX", "!")
    clean_env.setenv("CACHE_TTL_SECONDS", "60")
    clean_env.setenv("CACHE_PATH", "/tmp/zombies.sqlite3")
    clean_env.setenv("LEADERBOARD_SIZE", "25")
    clean_env.setenv("DEV_GUILD_ID", "123456789")
    clean_env.setenv("ENABLE_PREFIX_COMMANDS", "true")

    config = Config.from_env()

    assert config.command_prefix == "!"
    assert config.cache_ttl_seconds == 60
    assert config.cache_path == Path("/tmp/zombies.sqlite3")
    assert config.leaderboard_size == 25
    assert config.dev_guild_id == 123_456_789
    assert config.enable_prefix_commands is True


@pytest.mark.parametrize(
    ("value", "expected"),
    [("1", True), ("true", True), ("YES", True), ("on", True),
     ("0", False), ("false", False), ("no", False), ("", False)],
)
def test_boolean_parsing(clean_env, value, expected):
    for name, required in REQUIRED.items():
        clean_env.setenv(name, required)
    clean_env.setenv("ENABLE_PREFIX_COMMANDS", value)

    assert Config.from_env().enable_prefix_commands is expected


def test_non_numeric_integer_raises(clean_env):
    for name, value in REQUIRED.items():
        clean_env.setenv(name, value)
    clean_env.setenv("CACHE_TTL_SECONDS", "five minutes")

    with pytest.raises(ConfigError, match="CACHE_TTL_SECONDS"):
        Config.from_env()


def test_out_of_range_integer_raises(clean_env):
    for name, value in REQUIRED.items():
        clean_env.setenv(name, value)
    clean_env.setenv("LEADERBOARD_SIZE", "0")

    with pytest.raises(ConfigError, match="LEADERBOARD_SIZE"):
        Config.from_env()


def test_zero_ttl_is_allowed(clean_env):
    """A zero TTL disables caching, which is a legitimate configuration."""

    for name, value in REQUIRED.items():
        clean_env.setenv(name, value)
    clean_env.setenv("CACHE_TTL_SECONDS", "0")

    assert Config.from_env().cache_ttl_seconds == 0


def test_explicit_font_paths_are_kept(clean_env):
    for name, value in REQUIRED.items():
        clean_env.setenv(name, value)
    clean_env.setenv("FONT_REGULAR", "/fonts/Custom.ttf")

    assert Config.from_env().font_regular == "/fonts/Custom.ttf"
