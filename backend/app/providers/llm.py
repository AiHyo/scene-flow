from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Any, Optional

import httpx
from fastapi import HTTPException, status

from app.core.config import settings


def _has_image_part(messages: list[dict[str, Any]]) -> bool:
    for msg in messages:
        content = msg.get("content")
        if isinstance(content, list) and any(
            isinstance(p, dict) and p.get("type") == "image_url" for p in content
        ):
            return True
    return False


async def stream_chat_completions(
    messages: list[dict[str, Any]],
    model: Optional[str] = None,
    enable_thinking: bool = False,
) -> AsyncIterator[bytes]:
    """调用 OpenAI 兼容对话接口并透传 SSE 数据流"""
    if not settings.llm_api_key:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="服务端未配置 LLM_API_KEY",
        )

    target_model = model or (
        settings.llm_vision_model if _has_image_part(messages) else settings.llm_model
    )
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

    client = httpx.AsyncClient(timeout=httpx.Timeout(connect=15.0, read=120.0, write=30.0, pool=15.0))
    req = client.build_request("POST", url, headers=headers, json=payload)
    resp = await client.send(req, stream=True)
    if resp.status_code != 200:
        err_bytes = await resp.aread()
        await resp.aclose()
        await client.aclose()
        raise HTTPException(
            status_code=resp.status_code,
            detail=err_bytes.decode("utf-8", errors="replace") or f"上游对话服务异常 ({resp.status_code})",
        )

    async def _iter() -> AsyncIterator[bytes]:
        try:
            async for chunk in resp.aiter_bytes():
                if chunk:
                    yield chunk
        finally:
            await resp.aclose()
            await client.aclose()

    return _iter()
