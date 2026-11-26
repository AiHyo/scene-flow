"""Provider interfaces. Orchestration code depends on these, never on a vendor SDK.

Images arrive already resolved (bytes read through the SSRF-safe `ai.image_refs`);
providers never receive a user-supplied URL.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Any, Protocol

from app.ai.image_refs import ResolvedImage


class LLMProvider(Protocol):
    name: str
    model: str

    async def stream_chat(self, messages: list[dict[str, Any]]) -> AsyncIterator[bytes]:
        """Return an OpenAI-format SSE byte stream (`data: {chat.completion.chunk}` lines)."""
        ...


class VisionProvider(Protocol):
    name: str

    async def describe(self, question: str, image: ResolvedImage) -> str: ...


class SyncImageGenProvider(Protocol):
    """Generates within the call (OpenAI `/images/edits`); we run it as a background task."""

    name: str
    is_async: bool  # False

    async def edit(self, prompt: str, image: ResolvedImage) -> bytes: ...


@dataclass(frozen=True)
class AsyncImageStatus:
    done: bool
    succeeded: bool = False
    image: bytes | None = None
    message: str | None = None


class AsyncImageGenProvider(Protocol):
    """Generates at the provider (Kling); we keep its task id and poll it."""

    name: str
    is_async: bool  # True

    async def submit(
        self, prompt: str, image_urls: list[str], resolution: str | None, aspect_ratio: str | None
    ) -> str: ...

    async def query(self, provider_task_id: str) -> AsyncImageStatus: ...
