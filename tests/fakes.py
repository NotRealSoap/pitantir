"""A minimal stand-in for :class:`aiohttp.ClientSession`.

The API clients only ever use ``session.get(...)`` as an async context manager
and read ``status``, ``headers``, and ``json()`` off the response, so a fake this
small is enough to exercise every branch of their error handling without a
network or a test server.
"""

from __future__ import annotations

from typing import Any, Mapping, Sequence


class FakeResponse:
    """One canned HTTP response."""

    def __init__(
        self,
        status: int = 200,
        payload: Any = None,
        headers: Mapping[str, str] | None = None,
    ) -> None:
        self.status = status
        self.headers = dict(headers or {})
        self._payload = payload

    async def json(self, content_type: str | None = None) -> Any:
        return self._payload

    async def __aenter__(self) -> "FakeResponse":
        return self

    async def __aexit__(self, *_exc: object) -> bool:
        return False


class _RaisingContext:
    """A request that fails on entry, standing in for a transport error."""

    def __init__(self, error: BaseException) -> None:
        self._error = error

    async def __aenter__(self) -> Any:
        raise self._error

    async def __aexit__(self, *_exc: object) -> bool:
        return False


class FakeSession:
    """Replays ``responses`` in order, recording every request made."""

    def __init__(self, responses: Sequence[FakeResponse | BaseException]) -> None:
        self._responses = list(responses)
        self.requests: list[tuple[str, dict[str, Any]]] = []

    def get(self, url: str, **kwargs: Any) -> Any:
        self.requests.append((url, kwargs))
        if not self._responses:
            raise AssertionError(f"unexpected request to {url}")
        response = self._responses.pop(0)
        if isinstance(response, BaseException):
            return _RaisingContext(response)
        return response

    @property
    def request_count(self) -> int:
        return len(self.requests)

    def last_headers(self) -> dict[str, str]:
        return dict(self.requests[-1][1].get("headers") or {})

    def last_params(self) -> dict[str, Any]:
        return dict(self.requests[-1][1].get("params") or {})
