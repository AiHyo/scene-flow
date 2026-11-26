"""Scene image generation providers: OpenAI-compatible `/images/edits` and Kling Omni."""

from __future__ import annotations

import base64
from dataclasses import dataclass
from typing import Any

import httpx

from app.ai.image_refs import resolve_image_ref
from app.core.config import settings
from app.core.errors import ServiceMisconfigured, UpstreamError
from app.core.http import get_http_client
from app.storage import get_storage
from app.storage.base import public_url, upload

EDIT_TIMEOUT = httpx.Timeout(connect=15.0, read=180.0, write=60.0, pool=15.0)
SHORT_TIMEOUT = httpx.Timeout(30.0)


def provider_name() -> str:
    return "kling" if settings.img_gen_provider == "kling" else "openai"


def ensure_img_gen_configured() -> None:
    if provider_name() == "kling":
        if not settings.img_gen_base_url or not settings.img_gen_api_key:
            raise ServiceMisconfigured("服务端未配置 IMG_GEN_BASE_URL 或 IMG_GEN_API_KEY")
    elif not (settings.img_gen_base_url or settings.llm_base_url) or not (
        settings.img_gen_api_key or settings.llm_api_key
    ):
        raise ServiceMisconfigured("服务端未配置生图服务密钥（IMG_GEN_API_KEY 或 LLM_API_KEY）")


async def _download_provider_image(url: str) -> bytes | None:
    """Fetch a result image the *provider* returned (not a user-supplied URL)."""
    resp = await get_http_client().get(url, timeout=SHORT_TIMEOUT)
    return resp.content if resp.status_code == 200 and resp.content else None


def _json_or_none(resp: httpx.Response) -> dict[str, Any] | None:
    return resp.json() if resp.headers.get("content-type", "").startswith("application/json") else None


# ---- OpenAI-compatible (synchronous edit; we run it as a background task) ----


async def openai_edit(prompt: str, before_ref: str) -> str:
    """Edit the venue photo and store the result; returns the stored image's public URL."""
    base_url = (settings.img_gen_base_url or settings.llm_base_url).rstrip("/")
    api_key = settings.img_gen_api_key or settings.llm_api_key
    model = settings.img_gen_model or "gpt-image-2.6"

    before = await resolve_image_ref(before_ref)  # 白名单解析，不按用户 URL 抓取
    ext = "png" if "png" in before.content_type else "jpg"
    try:
        resp = await get_http_client().post(
            f"{base_url}/images/edits",
            headers={"Authorization": f"Bearer {api_key}"},
            data={"model": model, "prompt": prompt},
            files={"image": (f"venue.{ext}", before.data, before.content_type)},
            timeout=EDIT_TIMEOUT,
        )
    except httpx.RequestError as exc:
        raise UpstreamError(f"无法连接生图服务：{type(exc).__name__}") from exc
    if resp.status_code != 200:
        raise UpstreamError(f"生图服务异常（HTTP {resp.status_code}）：{resp.text[:200]}")

    item = (resp.json().get("data") or [{}])[0]
    img_bytes: bytes | None = None
    if item.get("b64_json"):
        img_bytes = base64.b64decode(item["b64_json"])
    elif item.get("url"):
        img_bytes = await _download_provider_image(item["url"])
    if not img_bytes:
        raise UpstreamError("生图服务未返回有效图片数据")

    url, _ = await upload(get_storage(), img_bytes, folder="generated", ext=".png", content_type="image/png")
    return url


# ---- Kling Omni (asynchronous at the provider) ----


async def kling_submit(prompt: str, image_keys: list[str], resolution: str | None, aspect_ratio: str | None) -> str:
    """Submit to Kling and return its task id. Kling fetches the images itself, so it
    only ever receives public URLs of objects in our own bucket."""
    storage = get_storage()
    payload: dict[str, Any] = {"prompt": prompt, "image_list": [{"image": public_url(storage, k)} for k in image_keys]}
    if resolution:
        payload["resolution"] = resolution
    if aspect_ratio:
        payload["aspect_ratio"] = aspect_ratio
    resp = await get_http_client().post(
        f"{settings.img_gen_base_url.rstrip('/')}/v1/images/omni-image",
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {settings.img_gen_api_key}"},
        json=payload,
        timeout=SHORT_TIMEOUT,
    )
    body = _json_or_none(resp)
    if resp.status_code != 200 or not body:
        raise UpstreamError((body or {}).get("message") or f"生图服务异常（HTTP {resp.status_code}）")
    data = body.get("data", body)
    task_id = data.get("task_id")
    if not task_id:
        raise UpstreamError("生图服务未返回任务编号")
    return str(task_id)


@dataclass(frozen=True)
class KlingStatus:
    done: bool
    succeeded: bool = False
    image_url: str | None = None
    message: str | None = None


async def kling_query(provider_task_id: str) -> KlingStatus:
    resp = await get_http_client().get(
        f"{settings.img_gen_base_url.rstrip('/')}/v1/images/omni-image/{provider_task_id}",
        headers={"Authorization": f"Bearer {settings.img_gen_api_key}"},
        timeout=SHORT_TIMEOUT,
    )
    body = _json_or_none(resp)
    if resp.status_code != 200 or not body:
        raise UpstreamError((body or {}).get("message") or f"生图查询异常（HTTP {resp.status_code}）")
    inner: dict[str, Any] = body.get("data", body)
    status = inner.get("task_status")
    if status == "failed":
        return KlingStatus(done=True, message=inner.get("task_status_msg") or "生图失败")
    if status != "succeed":
        return KlingStatus(done=False)

    images = inner.get("images") or (inner.get("task_result") or {}).get("images") or []
    origin_url = images[0].get("url") if images else None
    if not origin_url or not (img := await _download_provider_image(origin_url)):
        return KlingStatus(done=True, message="生图服务未返回有效图片数据")
    url, _ = await upload(get_storage(), img, folder="generated", ext=".jpg", content_type="image/jpeg")
    return KlingStatus(done=True, succeeded=True, image_url=url)
