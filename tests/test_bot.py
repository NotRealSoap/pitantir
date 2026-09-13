"""Tests for bot assembly and the process entry point.

``setup_hook`` is where the HTTP session, API clients, cache, and cog are wired
together, so it is exercised directly here; a mistake in it would otherwise only
appear when connecting to Discord for real.
"""

from __future__ import annotations

import discord
import pytest

from round105 import __main__ as entry_point
from round105.bot import Round105Bot
from round105.config import Config
from round105.errors import ConfigError


@pytest.fixture
def config(tmp_path) -> Config:
    return Config(
        discord_token="token",
        hypixel_api_key="key",
        cache_path=tmp_path / "cache.sqlite3",
    )


@pytest.fixture
async def bot(config, monkeypatch):
    """A bot with a stubbed command sync, so nothing touches the network."""

    instance = Round105Bot(config)
    synced: list[object] = []

    async def fake_sync(*, guild=None):
        synced.append(guild)
        return []

    monkeypatch.setattr(instance.tree, "sync", fake_sync)
    instance.synced_guilds = synced  # type: ignore[attr-defined]
    try:
        yield instance
    finally:
        await instance.close()


async def test_setup_hook_wires_everything(bot):
    await bot.setup_hook()

    assert bot.session is not None and not bot.session.closed
    assert bot.service is not None
    assert bot.get_cog("Zombies") is not None
    assert bot.get_command("stats") is not None


async def test_setup_hook_applies_cache_settings(config, monkeypatch, tmp_path):
    tuned = Config(
        discord_token="token",
        hypixel_api_key="key",
        cache_path=tmp_path / "tuned.sqlite3",
        cache_ttl_seconds=42,
        leaderboard_size=7,
    )
    instance = Round105Bot(tuned)

    async def fake_sync(*, guild=None):
        return []

    monkeypatch.setattr(instance.tree, "sync", fake_sync)
    try:
        await instance.setup_hook()
        assert instance.service is not None
        assert instance.service.leaderboard_size == 7
    finally:
        await instance.close()


async def test_commands_sync_globally_by_default(bot):
    await bot.setup_hook()

    assert bot.synced_guilds == [None]


async def test_dev_guild_scopes_the_sync(config, monkeypatch, tmp_path):
    dev_config = Config(
        discord_token="token",
        hypixel_api_key="key",
        cache_path=tmp_path / "dev.sqlite3",
        dev_guild_id=987_654_321,
    )
    instance = Round105Bot(dev_config)
    synced: list[object] = []

    async def fake_sync(*, guild=None):
        synced.append(guild)
        return []

    monkeypatch.setattr(instance.tree, "sync", fake_sync)
    try:
        await instance.setup_hook()
    finally:
        await instance.close()

    assert len(synced) == 1
    assert isinstance(synced[0], discord.Object)
    assert synced[0].id == 987_654_321


def test_prefix_commands_are_off_by_default(config):
    instance = Round105Bot(config)
    try:
        # The message content intent is privileged, so it must stay opt-in.
        assert instance.intents.message_content is False
        assert instance.intents.guilds is True
    finally:
        instance.store.close()


def test_enabling_prefix_commands_requests_the_intent(tmp_path):
    instance = Round105Bot(
        Config(
            discord_token="token",
            hypixel_api_key="key",
            cache_path=tmp_path / "cache.sqlite3",
            enable_prefix_commands=True,
        )
    )
    try:
        assert instance.intents.message_content is True
    finally:
        instance.store.close()


async def test_close_releases_the_session(bot):
    await bot.setup_hook()
    session = bot.session
    assert session is not None

    await bot.close()

    assert session.closed


def test_entry_point_reports_missing_configuration(monkeypatch, capsys):
    monkeypatch.delenv("DISCORD_TOKEN", raising=False)
    monkeypatch.delenv("HYPIXEL_API_KEY", raising=False)
    monkeypatch.setattr(entry_point, "load_dotenv", lambda *a, **k: False)

    assert entry_point.main() == 2
    assert "DISCORD_TOKEN" in capsys.readouterr().err


def test_entry_point_reports_a_rejected_token(monkeypatch, capsys):
    monkeypatch.setenv("DISCORD_TOKEN", "bad-token")
    monkeypatch.setenv("HYPIXEL_API_KEY", "key")
    monkeypatch.setattr(entry_point, "load_dotenv", lambda *a, **k: False)

    def fail(_config):
        raise discord.LoginFailure("Improper token has been passed.")

    monkeypatch.setattr(entry_point, "run", fail)

    assert entry_point.main() == 2
    assert "DISCORD_TOKEN" in capsys.readouterr().err


def test_entry_point_explains_a_missing_intent(monkeypatch, capsys):
    monkeypatch.setenv("DISCORD_TOKEN", "token")
    monkeypatch.setenv("HYPIXEL_API_KEY", "key")
    monkeypatch.setattr(entry_point, "load_dotenv", lambda *a, **k: False)

    def fail(_config):
        raise discord.PrivilegedIntentsRequired(discord.Intents.default())

    monkeypatch.setattr(entry_point, "run", fail)

    assert entry_point.main() == 2
    assert "ENABLE_PREFIX_COMMANDS" in capsys.readouterr().err


def test_entry_point_returns_zero_on_clean_shutdown(monkeypatch):
    monkeypatch.setenv("DISCORD_TOKEN", "token")
    monkeypatch.setenv("HYPIXEL_API_KEY", "key")
    monkeypatch.setattr(entry_point, "load_dotenv", lambda *a, **k: False)
    monkeypatch.setattr(entry_point, "run", lambda _config: None)

    assert entry_point.main() == 0


def test_config_error_is_raised_for_bad_values(monkeypatch):
    monkeypatch.setenv("DISCORD_TOKEN", "token")
    monkeypatch.setenv("HYPIXEL_API_KEY", "key")
    monkeypatch.setenv("CACHE_TTL_SECONDS", "soon")

    with pytest.raises(ConfigError):
        Config.from_env()
