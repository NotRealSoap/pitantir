"""Console entry point: ``python -m round105``."""

from __future__ import annotations

import logging
import sys

import discord
from dotenv import load_dotenv

from .bot import run
from .config import Config
from .errors import ConfigError


def main() -> int:
    load_dotenv()
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)-8s %(name)s: %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )
    # discord.py logs every gateway heartbeat at DEBUG; INFO is plenty.
    logging.getLogger("discord").setLevel(logging.WARNING)

    try:
        config = Config.from_env()
    except ConfigError as exc:
        print(f"Configuration error: {exc}", file=sys.stderr)
        return 2

    try:
        run(config)
    except discord.LoginFailure:
        print(
            "Discord rejected DISCORD_TOKEN. Copy a fresh token from the Bot tab "
            "of your application at https://discord.com/developers/applications.",
            file=sys.stderr,
        )
        return 2
    except discord.PrivilegedIntentsRequired:
        print(
            "This bot requested the message content intent but it is not enabled. "
            "Either enable it on the Bot tab of your application, or set "
            "ENABLE_PREFIX_COMMANDS=false to use slash commands only.",
            file=sys.stderr,
        )
        return 2

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
