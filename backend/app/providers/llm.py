from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from typing import Any

import httpx

from app.core.config import settings
from app.core.errors import ServiceMisconfigured, UpstreamError
from app.core.http import get_http_client

logger = logging.getLogger(__name__)

CHAT_TIMEOUT = httpx.Timeout(connect=15.0, read=120.0, write=30.0, pool=15.0)


def _has_image_part(messages: list[dict[str, Any]]) -> bool:
    for msg in messages:
        content = msg.get("content")
        if isinstance(content, list) and any(isinstance(p, dict) and p.get("type") == "image_url" for p in content):
            return True
    return False


async def stream_chat_completions(
    messages: list[dict[str, Any]],
    model: str | None = None,
    enable_thinking: bool = False,
) -> AsyncIterator[bytes]:
    """调用 OpenAI 兼容对话接口并透传 SSE 数据流"""
    if not settings.llm_api_key:
        raise ServiceMisconfigured("服务端未配置 LLM_API_KEY")

    target_model = model or (settings.llm_vision_model if _has_image_part(messages) else settings.llm_model)
    url = f"{settings.llm_base_url.rstrip('/')}/chat/completions"
    headers = {
        "Content-Type": "application/json",
        "Accept-Encoding": "identity",
        "Authorization": f"Bearer {settings.llm_api_key}",
    }
    payload: dict[str, Any] = {
        "model": target_model,
        "messages": messages,
        "stream": True,
    }
    if enable_thinking:
        payload["enable_thinking"] = True

    client = get_http_client()
    req = client.build_request("POST", url, headers=headers, json=payload, timeout=CHAT_TIMEOUT)
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
