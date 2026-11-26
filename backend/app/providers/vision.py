"""Vision model call (OpenAI-compatible chat with an inline image)."""

from __future__ import annotations

import base64

import httpx

from app.ai.image_refs import resolve_image_ref
from app.core.config import settings
from app.core.errors import ServiceMisconfigured, UpstreamError
from app.core.http import get_http_client

VISION_TIMEOUT = httpx.Timeout(connect=15.0, read=60.0, write=30.0, pool=15.0)


def ensure_vision_configured() -> None:
    if not (settings.vision_api_key or settings.llm_api_key):
        raise ServiceMisconfigured("服务端未配置 VISION_API_KEY 或 LLM_API_KEY")


async def describe_image(question: str, image_ref: str) -> str:
    """Return the model's description of a whitelisted image reference."""
    base_url = (settings.vision_base_url or settings.llm_base_url).rstrip("/")
    api_key = settings.vision_api_key or settings.llm_api_key
    model = settings.vision_model or settings.llm_vision_model

    # 经白名单解析器从对象存储读取，服务端不按用户给的 URL 发起请求
    image = await resolve_image_ref(image_ref)
    data_url = f"data:{image.content_type};base64,{base64.b64encode(image.data).decode('ascii')}"
    payload = {
        "model": model,
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
            f"{base_url}/chat/completions",
            headers={"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"},
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
