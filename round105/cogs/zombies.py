"""Zombies stat commands.

Every command is a hybrid command, so it works both as a slash command and with
the text prefix (the latter requires the privileged message content intent, which
``ENABLE_PREFIX_COMMANDS`` controls).
"""

from __future__ import annotations

import asyncio
import io
import logging

import discord
from discord import app_commands
from discord.ext import commands

from ..config import Config
from ..errors import Round105Error
from ..rendering import (
    Theme,
    render_kills_card,
    render_leaderboard_card,
    render_map_card,
    render_overview_card,
)
from ..service import StatsService
from ..zombies import (
    ALIEN_ARCADIUM,
    BAD_BLOOD,
    DEAD_END,
    METRICS,
    PRISON,
    ZombiesMap,
    find_metric,
)

log = logging.getLogger(__name__)

#: Seconds between uses of a stat command, per user. Lookups can cost an API
#: request, so this bounds how fast one person can spend the key's budget.
COOLDOWN_SECONDS = 4.0

USERNAME_DESCRIPTION = "Minecraft username to look up"


class ZombiesCog(commands.Cog, name="Zombies"):
    """Player statistics for Hypixel Zombies."""

    def __init__(self, bot: commands.Bot, service: StatsService, config: Config) -> None:
        self.bot = bot
        self.service = service
        self.config = config
        self.theme = Theme(
            font_regular=config.font_regular, font_bold=config.font_bold
        )

    async def _send_card(
        self,
        ctx: commands.Context,
        png: bytes,
        filename: str,
        note: str = "",
    ) -> None:
        file = discord.File(io.BytesIO(png), filename=filename)
        await ctx.send(content=note or None, file=file)

    async def _send_player_card(
        self, ctx: commands.Context, username: str, renderer, filename: str
    ) -> None:
        """Resolve a player, render their card, and reply with it."""

        await ctx.defer()
        snapshot = await self.service.lookup(username)
        png = await asyncio.to_thread(renderer, snapshot)
        note = ""
        if snapshot.is_stale:
            note = (
                "Hypixel is not responding, so this card is built from cached data."
            )
        await self._send_card(ctx, png, filename, note)

    async def _send_map_card(
        self, ctx: commands.Context, username: str, zombies_map: ZombiesMap
    ) -> None:
        await self._send_player_card(
            ctx,
            username,
            lambda snapshot: render_map_card(snapshot, zombies_map, self.theme),
            f"{zombies_map.id}.png",
        )

    # -- commands --------------------------------------------------------

    @commands.hybrid_command(
        name="stats", description="Overall Hypixel Zombies stats for a player"
    )
    @app_commands.describe(username=USERNAME_DESCRIPTION)
    @commands.cooldown(1, COOLDOWN_SECONDS, commands.BucketType.user)
    async def stats(self, ctx: commands.Context, username: str) -> None:
        await self._send_player_card(
            ctx,
            username,
            lambda snapshot: render_overview_card(snapshot, self.theme),
            "stats.png",
        )

    @commands.hybrid_command(
        name="deadend", aliases=["de"], description="Dead End stats for a player"
    )
    @app_commands.describe(username=USERNAME_DESCRIPTION)
    @commands.cooldown(1, COOLDOWN_SECONDS, commands.BucketType.user)
    async def deadend(self, ctx: commands.Context, username: str) -> None:
        await self._send_map_card(ctx, username, DEAD_END)

    @commands.hybrid_command(
        name="badblood", aliases=["bb"], description="Bad Blood stats for a player"
    )
    @app_commands.describe(username=USERNAME_DESCRIPTION)
    @commands.cooldown(1, COOLDOWN_SECONDS, commands.BucketType.user)
    async def badblood(self, ctx: commands.Context, username: str) -> None:
        await self._send_map_card(ctx, username, BAD_BLOOD)

    @commands.hybrid_command(
        name="alienarcadium",
        aliases=["aa"],
        description="Alien Arcadium stats for a player",
    )
    @app_commands.describe(username=USERNAME_DESCRIPTION)
    @commands.cooldown(1, COOLDOWN_SECONDS, commands.BucketType.user)
    async def alienarcadium(self, ctx: commands.Context, username: str) -> None:
        await self._send_map_card(ctx, username, ALIEN_ARCADIUM)

    @commands.hybrid_command(
        name="prison", description="Prison stats for a player"
    )
    @app_commands.describe(username=USERNAME_DESCRIPTION)
    @commands.cooldown(1, COOLDOWN_SECONDS, commands.BucketType.user)
    async def prison(self, ctx: commands.Context, username: str) -> None:
        await self._send_map_card(ctx, username, PRISON)

    @commands.hybrid_command(
        name="kills", description="Combat breakdown for a player"
    )
    @app_commands.describe(username=USERNAME_DESCRIPTION)
    @commands.cooldown(1, COOLDOWN_SECONDS, commands.BucketType.user)
    async def kills(self, ctx: commands.Context, username: str) -> None:
        await self._send_player_card(
            ctx,
            username,
            lambda snapshot: render_kills_card(snapshot, self.theme),
            "kills.png",
        )

    @commands.hybrid_command(
        name="rankings",
        aliases=["lb", "top"],
        description="Rank the players this bot has cached",
    )
    @app_commands.describe(metric="Stat to rank by")
    @app_commands.choices(
        metric=[
            app_commands.Choice(name=metric.label, value=metric.id)
            for metric in METRICS
        ]
    )
    @commands.cooldown(1, COOLDOWN_SECONDS, commands.BucketType.user)
    async def rankings(self, ctx: commands.Context, metric: str = "kills") -> None:
        await ctx.defer()

        resolved = find_metric(metric)
        if resolved is None:
            options = ", ".join(f"`{m.id}`" for m in METRICS)
            await ctx.send(f"Unknown stat `{metric}`. Try one of: {options}")
            return

        leaderboard = await self.service.leaderboard(resolved)
        png = await asyncio.to_thread(
            render_leaderboard_card,
            leaderboard,
            self.theme,
            "Players this bot has looked up, ranked from cached data",
        )
        await self._send_card(ctx, png, "rankings.png")

    # -- error handling --------------------------------------------------

    async def cog_command_error(
        self, ctx: commands.Context, error: commands.CommandError
    ) -> None:
        """Turn expected failures into a plain reply instead of a traceback."""

        original = getattr(error, "original", error)

        if isinstance(original, Round105Error):
            await self._reply_error(ctx, str(original))
            return

        if isinstance(error, commands.CommandOnCooldown):
            await self._reply_error(
                ctx,
                f"Slow down - try again in {error.retry_after:.1f}s.",
                ephemeral=True,
            )
            return

        if isinstance(error, commands.MissingRequiredArgument):
            await self._reply_error(
                ctx, f"Usage: `{ctx.prefix}{ctx.invoked_with} <username>`"
            )
            return

        log.exception(
            "Unhandled error in command %s", ctx.command, exc_info=original
        )
        await self._reply_error(
            ctx, "Something went wrong running that command. It has been logged."
        )

    async def _reply_error(
        self, ctx: commands.Context, message: str, ephemeral: bool = False
    ) -> None:
        try:
            await ctx.send(message, ephemeral=ephemeral)
        except discord.HTTPException:
            log.warning("Could not deliver error message: %s", message)


async def setup(bot: commands.Bot) -> None:
    """Extension entry point. Requires ``bot.service`` and ``bot.config``."""

    await bot.add_cog(ZombiesCog(bot, bot.service, bot.config))  # type: ignore[attr-defined]
