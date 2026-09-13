"""Minecraft username to UUID resolution via Mojang's public API."""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass

import aiohttp

from .errors import PlayerNotFound, UpstreamUnavailable

log = logging.getLogger(__name__)

PROFILE_URL = "https://api.mojang.com/users/profiles/minecraft/{username}"

#: Minecraft usernames are 3-16 characters of letters, digits, and underscores.
USERNAME_RE = re.compile(r"^\w{3,16}$")


def is_valid_username(username: str) -> bool:
    return bool(USERNAME_RE.match(username))


def dash_uuid(undashed: str) -> str:
    """Insert the hyphens Mojang omits, producing a canonical UUID string."""

    raw = undashed.replace("-", "")
    if len(raw) != 32:
        return undashed
    return f"{raw[0:8]}-{raw[8:12]}-{raw[12:16]}-{raw[16:20]}-{raw[20:32]}"


@dataclass(frozen=True)
class MojangProfile:
    """A resolved account. ``uuid`` is undashed, as Hypixel expects."""

    uuid: str
    name: str


class MojangClient:
    """Resolves usernames to UUIDs.

    Does not cache; :class:`~round105.service.StatsService` layers caching on top
    so the persistent store can also serve as an offline fallback.
    """

    def __init__(self, session: aiohttp.ClientSession, timeout_seconds: int = 10) -> None:
        self._session = session
        self._timeout = aiohttp.ClientTimeout(total=timeout_seconds)

    async def fetch_profile(self, username: str) -> MojangProfile:
        """Resolve ``username`` to a UUID.

        Raises :class:`PlayerNotFound` if no such account exists, or
        :class:`UpstreamUnavailable` if Mojang cannot be reached.
        """

        if not is_valid_username(username):
            raise PlayerNotFound(username)

        url = PROFILE_URL.format(username=username)
        try:
            async with self._session.get(url, timeout=self._timeout) as response:
                # Mojang has historically used both 204 and 404 for "no such user".
                if response.status in (204, 404):
                    raise PlayerNotFound(username)
                if response.status == 429:
                    raise UpstreamUnavailable("Mojang", "rate limited")
                if response.status >= 400:
                    raise UpstreamUnavailable("Mojang", f"HTTP {response.status}")

                payload = await response.json(content_type=None)
        except aiohttp.ClientError as exc:
            log.warning("Mojang request failed for %s: %s", username, exc)
            raise UpstreamUnavailable("Mojang", "connection error") from exc
        except TimeoutError as exc:
            log.warning("Mojang request timed out for %s", username)
            raise UpstreamUnavailable("Mojang", "timed out") from exc

        if not isinstance(payload, dict):
            raise UpstreamUnavailable("Mojang", "unexpected response")

        uuid = payload.get("id")
        name = payload.get("name") or username
        if not isinstance(uuid, str) or not uuid:
            raise PlayerNotFound(username)

        return MojangProfile(uuid=uuid.replace("-", ""), name=str(name))
