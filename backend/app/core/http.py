"""One shared httpx.AsyncClient for all outbound calls (connection pooling).

Created and closed by the app lifespan. Callers pass per-request timeouts.
"""

from __future__ import annotations

import httpx

_client: httpx.AsyncClient | None = None

DEFAULT_TIMEOUT = httpx.Timeout(connect=15.0, read=60.0, write=30.0, pool=15.0)


async def start_http_client() -> None:
    global _client
    if _client is None:
        _client = httpx.AsyncClient(timeout=DEFAULT_TIMEOUT)


async def close_http_client() -> None:
    global _client
    if _client is not None:
        await _client.aclose()
        _client = None


def get_http_client() -> httpx.AsyncClient:
    """Return the shared client, creating it lazily (e.g. in tests without lifespan)."""
    global _client
    if _client is None:
        _client = httpx.AsyncClient(timeout=DEFAULT_TIMEOUT)
    return _client
