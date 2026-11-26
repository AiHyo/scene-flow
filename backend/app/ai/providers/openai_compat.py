"""OpenAI-compatible chat, vision and image-edit providers (e.g. the CPA gateway)."""

from __future__ import annotations

import base64
import logging
from collections.abc import AsyncIterator
from typing import Any

import httpx

from app.ai.image_refs import ResolvedImage
from app.core.errors import UpstreamError
from app.core.http import get_http_client

logger = logging.getLogger(__name__)

CHAT_TIMEOUT = httpx.Timeout(connect=15.0, read=120.0, write=30.0, pool=15.0)
VISION_TIMEOUT = httpx.Timeout(connect=15.0, read=60.0, write=30.0, pool=15.0)
EDIT_TIMEOUT = httpx.Timeout(connect=15.0, read=180.0, write=60.0, pool=15.0)
SHORT_TIMEOUT = httpx.Timeout(30.0)


def _auth(api_key: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {api_key}"}


class OpenAICompatLLM:
    name = "openai"

    def __init__(self, base_url: str, api_key: str, model: str, vision_model: str):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.model = model
        self.vision_model = vision_model

    @staticmethod
    def _has_image_part(messages: list[dict[str, Any]]) -> bool:
        for msg in messages:
            content = msg.get("content")
            if isinstance(content, list) and any(isinstance(p, dict) and p.get("type") == "image_url" for p in content):
                return True
        return False

    async def stream_chat(self, messages: list[dict[str, Any]]) -> AsyncIterator[bytes]:
        model = self.vision_model if self._has_image_part(messages) else self.model
        client = get_http_client()
        req = client.build_request(
            "POST",
            f"{self.base_url}/chat/completions",
            headers={"Content-Type": "application/json", "Accept-Encoding": "identity", **_auth(self.api_key)},
            json={"model": model, "messages": messages, "stream": True},
            timeout=CHAT_TIMEOUT,
        )
        try:
            resp = await client.send(req, stream=True)
        except httpx.RequestError as exc:
            raise UpstreamError(f"无法连接对话服务：{type(exc).__name__}") from exc
        if resp.status_code != 200:
            err_text = (await resp.aread()).decode("utf-8", errors="replace")
            await resp.aclose()
            logger.warning("chat upstream %s: %s", resp.status_code, err_text[:500])
            raise UpstreamError(f"对话服务异常（HTTP {resp.status_code}）：{err_text[:200]}")

        async def _iter() -> AsyncIterator[bytes]:
            try:
                async for chunk in resp.aiter_bytes():
                    if chunk:
                        yield chunk
            finally:
                await resp.aclose()

        return _iter()


class OpenAICompatVision:
    name = "openai"

    def __init__(self, base_url: str, api_key: str, model: str):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.model = model

    async def describe(self, question: str, image: ResolvedImage) -> str:
        # Inline base64: the gateway cannot reach our (possibly private) object storage.
        data_url = f"data:{image.content_type};base64,{base64.b64encode(image.data).decode('ascii')}"
        payload = {
            "model": self.model,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": question},
                        {"type": "image_url", "image_url": {"url": data_url}},
                    ],
                }
            ],
        }
        try:
            resp = await get_http_client().post(
                f"{self.base_url}/chat/completions",
                headers={"Content-Type": "application/json", **_auth(self.api_key)},
                json=payload,
                timeout=VISION_TIMEOUT,
            )
        except httpx.RequestError as exc:
            raise UpstreamError(f"无法连接识图服务：{type(exc).__name__}") from exc
        if resp.status_code != 200:
            raise UpstreamError(f"识图服务异常（HTTP {resp.status_code}）：{resp.text[:200]}")
        content = resp.json().get("choices", [{}])[0].get("message", {}).get("content", "")
        if not content:
            raise UpstreamError("识图服务未返回内容")
        return content


class OpenAICompatImageEdit:
    name = "openai"
    is_async = False

    def __init__(self, base_url: str, api_key: str, model: str):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.model = model

    async def edit(self, prompt: str, image: ResolvedImage) -> bytes:
        ext = "png" if "png" in image.content_type else "jpg"
        try:
            resp = await get_http_client().post(
                f"{self.base_url}/images/edits",
                headers=_auth(self.api_key),
                data={"model": self.model, "prompt": prompt},
                files={"image": (f"venue.{ext}", image.data, image.content_type)},
                timeout=EDIT_TIMEOUT,
            )
        except httpx.RequestError as exc:
            raise UpstreamError(f"无法连接生图服务：{type(exc).__name__}") from exc
        if resp.status_code != 200:
            raise UpstreamError(f"生图服务异常（HTTP {resp.status_code}）：{resp.text[:200]}")

        item = (resp.json().get("data") or [{}])[0]
        if item.get("b64_json"):
            return base64.b64decode(item["b64_json"])
        if item.get("url"):
            # A URL returned by the provider (not user input) — safe to fetch.
            dl = await get_http_client().get(item["url"], timeout=SHORT_TIMEOUT)
            if dl.status_code == 200 and dl.content:
                return dl.content
        raise UpstreamError("生图服务未返回有效图片数据")
