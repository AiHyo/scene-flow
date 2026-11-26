from __future__ import annotations

import asyncio
import base64
import uuid
from typing import Any

import httpx

from app.ai.image_refs import resolve_image_ref, validate_image_ref
from app.core.config import settings
from app.core.errors import NotFound, ServiceMisconfigured, UpstreamError
from app.core.http import get_http_client
from app.storage import get_storage
from app.storage.base import public_url, upload

# 轻量内存任务表，将同步 /v1/images/edits 接口适配为前端轮询契约（下一步改为数据库持久化）
_SCENE_TASKS: dict[str, dict[str, Any]] = {}
_RUNNING: set[asyncio.Task] = set()

EDIT_TIMEOUT = httpx.Timeout(connect=15.0, read=180.0, write=60.0, pool=15.0)
SHORT_TIMEOUT = httpx.Timeout(30.0)


def _resolve_openai_img_config() -> tuple[str, str, str]:
    base_url = (settings.img_gen_base_url or settings.llm_base_url).rstrip("/")
    api_key = settings.img_gen_api_key or settings.llm_api_key
    model = settings.img_gen_model or "gpt-image-2.6"
    if not base_url or not api_key:
        raise ServiceMisconfigured("服务端未配置生图服务密钥（IMG_GEN_API_KEY 或 LLM_API_KEY）")
    return base_url, api_key, model


async def _download_provider_image(url: str) -> bytes | None:
    """Fetch a result image the *provider* returned (not a user-supplied URL)."""
    resp = await get_http_client().get(url, timeout=SHORT_TIMEOUT)
    return resp.content if resp.status_code == 200 and resp.content else None


async def _run_openai_edit_task(task_id: str, prompt: str, before_ref: str) -> None:
    base_url, api_key, model = _resolve_openai_img_config()
    try:
        # 经白名单解析器读取场地底图，服务端不按用户给的 URL 发起请求
        before = await resolve_image_ref(before_ref)
        ext = "png" if "png" in before.content_type else "jpg"
        resp = await get_http_client().post(
            f"{base_url}/images/edits",
            headers={"Authorization": f"Bearer {api_key}"},
            data={"model": model, "prompt": prompt},
            files={"image": (f"venue.{ext}", before.data, before.content_type)},
            timeout=EDIT_TIMEOUT,
        )
        if resp.status_code != 200:
            _SCENE_TASKS[task_id] = {
                "task_status": "failed",
                "task_status_msg": f"生图服务异常 ({resp.status_code}): {resp.text[:200]}",
            }
            return

        item = (resp.json().get("data") or [{}])[0]
        img_bytes: bytes | None = None
        if item.get("b64_json"):
            img_bytes = base64.b64decode(item["b64_json"])
        elif item.get("url"):
            img_bytes = await _download_provider_image(item["url"])

        if not img_bytes:
            _SCENE_TASKS[task_id] = {"task_status": "failed", "task_status_msg": "生图服务未返回有效图片数据"}
            return

        url, _ = await upload(get_storage(), img_bytes, folder="generated", ext=".png", content_type="image/png")
        _SCENE_TASKS[task_id] = {"task_status": "succeed", "images": [{"url": url}]}
    except Exception as exc:
        _SCENE_TASKS[task_id] = {"task_status": "failed", "task_status_msg": f"生图请求失败: {exc}"}


async def submit_scene_gen(
    prompt: str,
    image_refs: list[str],
    resolution: str | None = None,
    aspect_ratio: str | None = None,
) -> dict[str, Any]:
    """提交场景布置生图任务。image_refs 已由调用方保证非空。"""
    keys = [validate_image_ref(ref) for ref in image_refs]  # 非法引用在提交阶段直接 400

    if settings.img_gen_provider == "kling":
        base_url = settings.img_gen_base_url.rstrip("/")
        api_key = settings.img_gen_api_key
        if not base_url or not api_key:
            raise ServiceMisconfigured("服务端未配置 IMG_GEN_BASE_URL 或 IMG_GEN_API_KEY")
        # 可灵由上游自行拉取图片：只交给它本桶的公开地址，我方服务器不发起抓取
        storage = get_storage()
        payload: dict[str, Any] = {"prompt": prompt, "image_list": [{"image": public_url(storage, k)} for k in keys]}
        if resolution:
            payload["resolution"] = resolution
        if aspect_ratio:
            payload["aspect_ratio"] = aspect_ratio
        resp = await get_http_client().post(
            f"{base_url}/v1/images/omni-image",
            headers={"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"},
            json=payload,
            timeout=SHORT_TIMEOUT,
        )
        body = resp.json() if resp.headers.get("content-type", "").startswith("application/json") else None
        if resp.status_code != 200 or not body:
            raise UpstreamError((body or {}).get("message") or f"生图服务异常（HTTP {resp.status_code}）")
        return body.get("data", body)

    _resolve_openai_img_config()
    task_id = uuid.uuid4().hex
    _SCENE_TASKS[task_id] = {"task_status": "processing"}
    task = asyncio.create_task(_run_openai_edit_task(task_id, prompt, image_refs[0]))
    _RUNNING.add(task)
    task.add_done_callback(_RUNNING.discard)
    return {"task_id": task_id, "task_status": "submitted"}


async def query_scene_gen(task_id: str) -> dict[str, Any]:
    """查询场景生图任务状态"""
    if settings.img_gen_provider == "kling":
        base_url = settings.img_gen_base_url.rstrip("/")
        api_key = settings.img_gen_api_key
        resp = await get_http_client().get(
            f"{base_url}/v1/images/omni-image/{task_id}",
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=SHORT_TIMEOUT,
        )
        body = resp.json() if resp.headers.get("content-type", "").startswith("application/json") else None
        if resp.status_code != 200 or not body:
            raise UpstreamError((body or {}).get("message") or f"生图查询异常（HTTP {resp.status_code}）")
        inner: dict[str, Any] = body.get("data", body)
        nested_images = (inner.get("task_result") or {}).get("images")
        if nested_images and not inner.get("images"):
            inner["images"] = nested_images
        if inner.get("task_status") == "succeed" and inner.get("images"):
            origin_url = inner["images"][0].get("url")
            if origin_url and (img := await _download_provider_image(origin_url)):
                url, _ = await upload(get_storage(), img, folder="generated", ext=".jpg", content_type="image/jpeg")
                inner["images"] = [{"url": url}]
        return inner

    task = _SCENE_TASKS.get(task_id)
    if not task:
        raise NotFound("生图任务不存在")
    if task.get("task_status") != "processing":
        _SCENE_TASKS.pop(task_id, None)
    return task
