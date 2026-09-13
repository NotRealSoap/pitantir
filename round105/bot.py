"""Bot assembly: wires the config, HTTP clients, cache, and commands together."""

from __future__ import annotations

import logging

import aiohttp
import discord
from discord.ext import commands

from . import __version__
from .config import Config
from .hypixel import HypixelClient
from .mojang import MojangClient
from .service import StatsService
from .store import PlayerStore

log = logging.getLogger(__name__)

USER_AGENT = f"Round105/{__version__} (+https://github.com/topics/hypixel)"


class Round105Bot(commands.Bot):
    """Discord client for the Zombies stat commands."""

    def __init__(self, config: Config) -> None:
        intents = discord.Intents.none()
        intents.guilds = True
        if config.enable_prefix_commands:
            # Reading command text from messages is a privileged intent and must
            # also be enabled on the bot's application page.
            intents.message_content = True

        super().__init__(
            command_prefix=commands.when_mentioned_or(config.command_prefix),
            intents=intents,
            help_command=commands.DefaultHelpCommand(no_category="Commands"),
            allowed_mentions=discord.AllowedMentions.none(),
        )
        self.config = config
        self.store = PlayerStore(config.cache_path)
        self.session: aiohttp.ClientSession | None = None
        self.service: StatsService | None = None

    async def setup_hook(self) -> None:
        self.session = aiohttp.ClientSession(headers={"User-Agent": USER_AGENT})
        self.service = StatsService(
            mojang=MojangClient(self.session, self.config.request_timeout_seconds),
            hypixel=HypixelClient(
                self.session,
                self.config.hypixel_api_key,
                self.config.request_timeout_seconds,
            ),
            store=self.store,
            cache_ttl_seconds=self.config.cache_ttl_seconds,
            name_ttl_seconds=self.config.name_ttl_seconds,
            leaderboard_size=self.config.leaderboard_size,
        )

        await self.load_extension("round105.cogs.zombies")

        if self.config.dev_guild_id:
            guild = discord.Object(id=self.config.dev_guild_id)
            self.tree.copy_global_to(guild=guild)
            synced = await self.tree.sync(guild=guild)
            log.info(
                "Synced %d slash commands to guild %s",
                len(synced),
                self.config.dev_guild_id,
            )
        else:
            synced = await self.tree.sync()
            log.info("Synced %d slash commands globally", len(synced))

    async def on_ready(self) -> None:
        user = self.user
        log.info(
            "Connected as %s in %d guild(s); %d players cached",
            user,
            len(self.guilds),
            self.store.count_players(),
        )
        await self.change_presence(
            activity=discord.Activity(
                type=discord.ActivityType.watching, name="Hypixel Zombies"
            )
        )

    async def close(self) -> None:
        try:
            await super().close()
        finally:
            if self.session is not None and not self.session.closed:
                await self.session.close()
            self.store.close()


def run(config: Config | None = None) -> None:
    """Start the bot, blocking until it disconnects."""

    resolved = config or Config.from_env()
    bot = Round105Bot(resolved)
    bot.run(resolved.discord_token, log_handler=None)
