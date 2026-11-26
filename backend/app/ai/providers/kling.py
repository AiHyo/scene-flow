"""Kling Omni image generation (asynchronous at the provider)."""

from __future__ import annotations

from typing import Any

import httpx

from app.ai.providers.base import AsyncImageStatus
from app.core.errors import UpstreamError
from app.core.http import get_http_client

SHORT_TIMEOUT = httpx.Timeout(30.0)


def _json_or_none(resp: httpx.Response) -> dict[str, Any] | None:
    return resp.json() if resp.headers.get("content-type", "").startswith("application/json") else None


class KlingImageGen:
    name = "kling"
    is_async = True

    def __init__(self, base_url: str, api_key: str):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key

    async def submit(self, prompt: str, image_urls: list[str], resolution: str | None, aspect_ratio: str | None) -> str:
        """`image_urls` must already be public URLs of validated objects in our bucket:
        Kling fetches them itself."""
        payload: dict[str, Any] = {"prompt": prompt, "image_list": [{"image": u} for u in image_urls]}
        if resolution:
            payload["resolution"] = resolution
        if aspect_ratio:
            payload["aspect_ratio"] = aspect_ratio
        resp = await get_http_client().post(
            f"{self.base_url}/v1/images/omni-image",
            headers={"Content-Type": "application/json", "Authorization": f"Bearer {self.api_key}"},
            json=payload,
            timeout=SHORT_TIMEOUT,
        )
        body = _json_or_none(resp)
        if resp.status_code != 200 or not body:
            raise UpstreamError((body or {}).get("message") or f"生图服务异常（HTTP {resp.status_code}）")
        task_id = body.get("data", body).get("task_id")
        if not task_id:
            raise UpstreamError("生图服务未返回任务编号")
        return str(task_id)

    async def query(self, provider_task_id: str) -> AsyncImageStatus:
        resp = await get_http_client().get(
            f"{self.base_url}/v1/images/omni-image/{provider_task_id}",
            headers={"Authorization": f"Bearer {self.api_key}"},
            timeout=SHORT_TIMEOUT,
        )
        body = _json_or_none(resp)
        if resp.status_code != 200 or not body:
            raise UpstreamError((body or {}).get("message") or f"生图查询异常（HTTP {resp.status_code}）")
        inner: dict[str, Any] = body.get("data", body)
        status = inner.get("task_status")
        if status == "failed":
            return AsyncImageStatus(done=True, message=inner.get("task_status_msg") or "生图失败")
        if status != "succeed":
            return AsyncImageStatus(done=False)

        images = inner.get("images") or (inner.get("task_result") or {}).get("images") or []
        origin_url = images[0].get("url") if images else None
        if origin_url:
            # Result URL returned by the provider (not user input).
            dl = await get_http_client().get(origin_url, timeout=SHORT_TIMEOUT)
            if dl.status_code == 200 and dl.content:
                return AsyncImageStatus(done=True, succeeded=True, image=dl.content)
        return AsyncImageStatus(done=True, message="生图服务未返回有效图片数据")
