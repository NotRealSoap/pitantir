"""Tests for the command layer.

Discord is never contacted: commands are invoked through their callbacks with a
fake context, which is enough to check that each one defers, renders, and
attaches a PNG, and that failures come back as readable messages.
"""

from __future__ import annotations

import inspect

import discord
import pytest
from discord.ext import commands

from round105.cogs.zombies import ZombiesCog
from round105.config import Config, _find_font
from round105.errors import NoZombiesData, PlayerNotFound, UpstreamUnavailable

from .conftest import SAMPLE_NAME

PNG_MAGIC = b"\x89PNG\r\n\x1a\n"


class FakeContext:
    """The slice of :class:`discord.ext.commands.Context` the cog touches."""

    def __init__(self, prefix: str = "z!", invoked_with: str = "stats") -> None:
        self.prefix = prefix
        self.invoked_with = invoked_with
        self.command = None
        self.deferred = False
        self.sent: list[dict] = []

    async def defer(self) -> None:
        self.deferred = True

    async def send(
        self,
        content: str | None = None,
        *,
        file: discord.File | None = None,
        ephemeral: bool = False,
    ) -> None:
        self.sent.append({"content": content, "file": file, "ephemeral": ephemeral})

    @property
    def last(self) -> dict:
        assert self.sent, "nothing was sent"
        return self.sent[-1]


def attachment_bytes(message: dict) -> bytes:
    file = message["file"]
    assert file is not None
    return file.fp.getvalue()


@pytest.fixture
def config() -> Config:
    return Config(
        discord_token="token",
        hypixel_api_key="key",
        font_regular=_find_font("regular"),
        font_bold=_find_font("bold"),
    )


@pytest.fixture
def cog(service, config) -> ZombiesCog:
    bot = object()  # the cog only stores the bot reference
    return ZombiesCog(bot, service, config)  # type: ignore[arg-type]


@pytest.fixture
def ctx() -> FakeContext:
    return FakeContext()


async def test_stats_command_attaches_a_png(cog, ctx):
    await cog.stats.callback(cog, ctx, SAMPLE_NAME)

    assert ctx.deferred
    assert len(ctx.sent) == 1
    assert ctx.last["file"].filename == "stats.png"
    assert attachment_bytes(ctx.last).startswith(PNG_MAGIC)
    # No warning banner for fresh data.
    assert ctx.last["content"] is None


async def test_kills_command_attaches_a_png(cog, ctx):
    await cog.kills.callback(cog, ctx, SAMPLE_NAME)

    assert ctx.last["file"].filename == "kills.png"
    assert attachment_bytes(ctx.last).startswith(PNG_MAGIC)


@pytest.mark.parametrize(
    ("command", "filename"),
    [
        ("deadend", "deadend.png"),
        ("badblood", "badblood.png"),
        ("prison", "prison.png"),
        ("alienarcadium", "alienarcadium.png"),
    ],
)
async def test_map_commands_attach_their_own_png(cog, ctx, command, filename):
    await getattr(cog, command).callback(cog, ctx, SAMPLE_NAME)

    assert ctx.last["file"].filename == filename
    assert attachment_bytes(ctx.last).startswith(PNG_MAGIC)


async def test_stale_data_is_flagged_to_the_user(cog, ctx, clock):
    await cog.stats.callback(cog, ctx, SAMPLE_NAME)
    clock.advance(7_200)
    cog.service.fake_hypixel.fail_with = UpstreamUnavailable("Hypixel", "timed out")

    follow_up = FakeContext()
    await cog.stats.callback(cog, follow_up, SAMPLE_NAME)

    assert "cached data" in follow_up.last["content"]
    assert attachment_bytes(follow_up.last).startswith(PNG_MAGIC)


async def test_rankings_attaches_a_png(cog, ctx, store, sample_player):
    store.put_player("uuid-1", "Alpha", sample_player)

    await cog.rankings.callback(cog, ctx, "kills")

    assert ctx.deferred
    assert ctx.last["file"].filename == "rankings.png"
    assert attachment_bytes(ctx.last).startswith(PNG_MAGIC)


async def test_rankings_defaults_to_kills(cog, ctx, store, sample_player):
    store.put_player("uuid-1", "Alpha", sample_player)

    await cog.rankings.callback(cog, ctx)

    assert ctx.last["file"] is not None


async def test_rankings_rejects_an_unknown_metric(cog, ctx):
    await cog.rankings.callback(cog, ctx, "vibes")

    assert ctx.last["file"] is None
    assert "Unknown stat" in ctx.last["content"]
    # The reply lists what the user could have asked for instead.
    assert "`kills`" in ctx.last["content"]


async def test_rankings_renders_when_nothing_is_cached(cog, ctx):
    await cog.rankings.callback(cog, ctx, "wins")

    assert attachment_bytes(ctx.last).startswith(PNG_MAGIC)


async def test_unknown_player_surfaces_as_an_error(cog, ctx):
    with pytest.raises(PlayerNotFound):
        await cog.stats.callback(cog, ctx, "NotARealAccount")

    # The command raises; the error handler is what replies.
    assert ctx.sent == []


@pytest.mark.parametrize(
    "error",
    [
        PlayerNotFound("Ghost"),
        NoZombiesData("Ghost"),
        UpstreamUnavailable("Hypixel", "timed out"),
    ],
)
async def test_error_handler_reports_expected_failures(cog, ctx, error):
    await cog.cog_command_error(ctx, commands.CommandInvokeError(error))

    assert ctx.last["content"] == str(error)


async def test_error_handler_reports_bare_errors(cog, ctx):
    """Checks raise before invocation, so the error is not wrapped."""

    error = NoZombiesData("Ghost")
    await cog.cog_command_error(ctx, error)  # type: ignore[arg-type]

    assert ctx.last["content"] == str(error)


async def test_error_handler_reports_cooldown_privately(cog, ctx):
    error = commands.CommandOnCooldown(
        commands.Cooldown(1, 4.0), 2.5, commands.BucketType.user
    )

    await cog.cog_command_error(ctx, error)

    assert "2.5s" in ctx.last["content"]
    assert ctx.last["ephemeral"] is True


async def test_error_handler_shows_usage_for_a_missing_argument(cog, ctx):
    parameter = commands.Parameter(
        name="username", kind=inspect.Parameter.POSITIONAL_OR_KEYWORD
    )

    await cog.cog_command_error(ctx, commands.MissingRequiredArgument(parameter))

    assert ctx.last["content"] == "Usage: `z!stats <username>`"


async def test_error_handler_hides_unexpected_failures(cog, ctx, caplog):
    await cog.cog_command_error(
        ctx, commands.CommandInvokeError(RuntimeError("kaboom"))
    )

    message = ctx.last["content"]
    # The user gets a generic apology; the detail only goes to the log.
    assert "kaboom" not in message
    assert "went wrong" in message
    assert any("Unhandled error" in record.message for record in caplog.records)


async def test_error_handler_survives_an_undeliverable_reply(cog):
    class DeadContext(FakeContext):
        async def send(self, *args, **kwargs):
            raise discord.HTTPException(_FakeResponse(), "cannot send")

    # Must not raise, or the failure would replace the original error.
    await cog.cog_command_error(
        DeadContext(), commands.CommandInvokeError(NoZombiesData("Ghost"))
    )


class _FakeResponse:
    status = 403
    reason = "Forbidden"


async def test_commands_and_aliases_are_registered(service, config):
    """Verifies the wiring discord.py does when the cog is added to a bot."""

    bot = commands.Bot(command_prefix="z!", intents=discord.Intents.none())
    await bot.add_cog(ZombiesCog(bot, service, config))

    expected = {
        "stats",
        "deadend",
        "badblood",
        "alienarcadium",
        "prison",
        "kills",
        "rankings",
    }
    assert expected <= {command.name for command in bot.commands}

    for alias, target in (
        ("de", "deadend"),
        ("bb", "badblood"),
        ("aa", "alienarcadium"),
        ("lb", "rankings"),
        ("top", "rankings"),
    ):
        command = bot.get_command(alias)
        assert command is not None, alias
        assert command.name == target

    # Each hybrid command must also exist as a slash command.
    assert expected <= {command.name for command in bot.tree.get_commands()}


async def test_rankings_exposes_metric_choices(service, config):
    bot = commands.Bot(command_prefix="z!", intents=discord.Intents.none())
    await bot.add_cog(ZombiesCog(bot, service, config))

    rankings = next(
        command for command in bot.tree.get_commands() if command.name == "rankings"
    )
    choices = {choice.value for choice in rankings.parameters[0].choices}

    assert {"kills", "wins", "best_round", "kdr", "accuracy"} <= choices
