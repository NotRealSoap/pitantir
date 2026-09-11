"""Runtime configuration, read from the environment."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from .errors import ConfigError

#: Fonts to try, in order, when no explicit path is configured. Covers the usual
#: Linux, macOS, and Windows locations so the bot renders without extra setup.
_FONT_CANDIDATES: dict[str, tuple[str, ...]] = {
    "regular": (
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
        "/Library/Fonts/Arial.ttf",
        "/System/Library/Fonts/Supplemental/Arial.ttf",
        "C:/Windows/Fonts/arial.ttf",
    ),
    "bold": (
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
        "/Library/Fonts/Arial Bold.ttf",
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
        "C:/Windows/Fonts/arialbd.ttf",
    ),
}


def _find_font(kind: str) -> str | None:
    for candidate in _FONT_CANDIDATES[kind]:
        if Path(candidate).is_file():
            return candidate
    return None


def _env_int(name: str, default: int, minimum: int | None = None) -> int:
    raw = os.environ.get(name)
    if raw is None or not raw.strip():
        return default
    try:
        value = int(raw)
    except ValueError as exc:
        raise ConfigError(f"{name} must be an integer, got {raw!r}") from exc
    if minimum is not None and value < minimum:
        raise ConfigError(f"{name} must be >= {minimum}, got {value}")
    return value


def _env_bool(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None or not raw.strip():
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class Config:
    """Everything the bot needs to start."""

    discord_token: str
    hypixel_api_key: str
    command_prefix: str = "z!"
    cache_path: Path = Path("data/cache.sqlite3")
    #: How long a cached player stays fresh. Hypixel updates stats on game end,
    #: so a few minutes of staleness is invisible to users but removes most calls.
    cache_ttl_seconds: int = 300
    #: Username -> UUID mappings change rarely, so they are cached far longer.
    name_ttl_seconds: int = 86_400
    request_timeout_seconds: int = 10
    leaderboard_size: int = 10
    #: Sync slash commands to this guild only. Guild syncs are instant, whereas a
    #: global sync can take up to an hour to propagate - set this while developing.
    dev_guild_id: int | None = None
    #: Prefix commands need the privileged message content intent, so they are
    #: opt-in; slash commands work without it.
    enable_prefix_commands: bool = False
    font_regular: str | None = None
    font_bold: str | None = None

    @classmethod
    def from_env(cls) -> "Config":
        """Build a config from environment variables, validating as we go."""

        token = os.environ.get("DISCORD_TOKEN", "").strip()
        if not token:
            raise ConfigError(
                "DISCORD_TOKEN is not set. Copy .env.example to .env and fill it in."
            )

        api_key = os.environ.get("HYPIXEL_API_KEY", "").strip()
        if not api_key:
            raise ConfigError(
                "HYPIXEL_API_KEY is not set. Create a key at developer.hypixel.net."
            )

        dev_guild = _env_int("DEV_GUILD_ID", 0, minimum=0) or None

        return cls(
            discord_token=token,
            hypixel_api_key=api_key,
            command_prefix=os.environ.get("COMMAND_PREFIX", "z!"),
            cache_path=Path(
                os.environ.get("CACHE_PATH", "data/cache.sqlite3")
            ).expanduser(),
            cache_ttl_seconds=_env_int("CACHE_TTL_SECONDS", 300, minimum=0),
            name_ttl_seconds=_env_int("NAME_TTL_SECONDS", 86_400, minimum=0),
            request_timeout_seconds=_env_int("REQUEST_TIMEOUT_SECONDS", 10, minimum=1),
            leaderboard_size=_env_int("LEADERBOARD_SIZE", 10, minimum=1),
            dev_guild_id=dev_guild,
            enable_prefix_commands=_env_bool("ENABLE_PREFIX_COMMANDS", False),
            font_regular=os.environ.get("FONT_REGULAR") or _find_font("regular"),
            font_bold=os.environ.get("FONT_BOLD") or _find_font("bold"),
        )
