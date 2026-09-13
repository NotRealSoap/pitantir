"""Exceptions raised by the stats pipeline.

Every error carries a message that is safe to show to a Discord user, so command
handlers can report failures without translating error types themselves.
"""

from __future__ import annotations


class Round105Error(Exception):
    """Base class for errors that are safe to surface to users."""


class ConfigError(Round105Error):
    """Raised when required configuration is missing or malformed."""


class PlayerNotFound(Round105Error):
    def __init__(self, username: str) -> None:
        self.username = username
        super().__init__(f"No Minecraft account named `{username}` exists.")


class PlayerNeverLoggedIn(Round105Error):
    def __init__(self, username: str) -> None:
        self.username = username
        super().__init__(f"`{username}` has never logged in to Hypixel.")


class NoZombiesData(Round105Error):
    def __init__(self, username: str) -> None:
        self.username = username
        super().__init__(f"`{username}` has no recorded Zombies games.")


class UpstreamUnavailable(Round105Error):
    """An upstream API failed and no cached copy was available."""

    def __init__(self, service: str, detail: str = "") -> None:
        self.service = service
        self.detail = detail
        message = f"The {service} API is not responding right now."
        if detail:
            message = f"{message} ({detail})"
        super().__init__(message)


class InvalidApiKey(Round105Error):
    def __init__(self) -> None:
        super().__init__(
            "The configured Hypixel API key was rejected. "
            "Regenerate it at developer.hypixel.net and update HYPIXEL_API_KEY."
        )


class RateLimited(Round105Error):
    def __init__(self, retry_after: float) -> None:
        self.retry_after = retry_after
        super().__init__(
            f"Hypixel is rate limiting this bot. Try again in {retry_after:.0f}s."
        )
