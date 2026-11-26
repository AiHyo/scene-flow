from __future__ import annotations

import asyncio
import base64
import uuid
from typing import Any

import httpx

from app.core.config import settings
from app.core.errors import NotFound, ServiceMisconfigured, UpstreamError
from app.storage.s3 import upload_bytes

# 轻量内存任务表，将同步 /v1/images/edits 接口适配为前端轮询契约
_SCENE_TASKS: dict[str, dict[str, Any]] = {}


def _resolve_openai_img_config() -> tuple[str, str, str]:
    base_url = (settings.img_gen_base_url or settings.llm_base_url).rstrip("/")
    api_key = settings.img_gen_api_key or settings.llm_api_key
    model = settings.img_gen_model or "gpt-image-2.6"
    if not base_url or not api_key:
        raise ServiceMisconfigured("服务端未配置生图服务密钥（IMG_GEN_API_KEY 或 LLM_API_KEY）")
    return base_url, api_key, model


async def _run_openai_edit_task(task_id: str, prompt: str, before_url: str) -> None:
    base_url, api_key, model = _resolve_openai_img_config()
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            ref_resp = await client.get(before_url)
        if ref_resp.status_code != 200 or not ref_resp.content:
            _SCENE_TASKS[task_id] = {
                "task_status": "failed",
                "task_status_msg": f"无法读取场地底图（HTTP {ref_resp.status_code}）",
            }
            return

        ref_ct = ref_resp.headers.get("content-type", "image/jpeg").split(";")[0].strip()
        ext = "png" if "png" in ref_ct else "jpg"

        async with httpx.AsyncClient(timeout=180.0) as client:
            resp = await client.post(
                f"{base_url}/images/edits",
                headers={"Authorization": f"Bearer {api_key}"},
                data={"model": model, "prompt": prompt},
                files={"image": (f"venue.{ext}", ref_resp.content, ref_ct)},
            )

        if resp.status_code != 200:
            _SCENE_TASKS[task_id] = {
                "task_status": "failed",
                "task_status_msg": f"生图服务异常 ({resp.status_code}): {resp.text[:200]}",
            }
            return

        body = resp.json()
        item = (body.get("data") or [{}])[0]
        img_bytes: bytes | None = None
        if item.get("b64_json"):
            img_bytes = base64.b64decode(item["b64_json"])
        elif item.get("url"):
            async with httpx.AsyncClient(timeout=30.0) as client:
                dl = await client.get(item["url"])
            if dl.status_code == 200:
                img_bytes = dl.content

        if not img_bytes:
            _SCENE_TASKS[task_id] = {
                "task_status": "failed",
                "task_status_msg": "生图服务未返回有效图片数据",
            }
            return

        public_url, _ = await upload_bytes(img_bytes, folder="generated", ext=".png", content_type="image/png")
        _SCENE_TASKS[task_id] = {
            "task_status": "succeed",
            "images": [{"url": public_url}],
        }
    except Exception as exc:
        _SCENE_TASKS[task_id] = {
            "task_status": "failed",
            "task_status_msg": f"生图请求失败: {exc}",
        }


async def submit_scene_gen(
    prompt: str,
    image_list: list[dict[str, str]],
    resolution: str | None = None,
    aspect_ratio: str | None = None,
) -> dict[str, Any]:
    """提交场景布置生图任务"""
    if settings.img_gen_provider == "kling":
        base_url = settings.img_gen_base_url.rstrip("/")
        api_key = settings.img_gen_api_key
        if not base_url or not api_key:
            raise ServiceMisconfigured("服务端未配置 IMG_GEN_BASE_URL 或 IMG_GEN_API_KEY")
        payload: dict[str, Any] = {"prompt": prompt, "image_list": image_list}
        if resolution:
            payload["resolution"] = resolution
        if aspect_ratio:
            payload["aspect_ratio"] = aspect_ratio
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                f"{base_url}/v1/images/omni-image",
                headers={"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"},
                json=payload,
            )
        body = resp.json() if resp.headers.get("content-type", "").startswith("application/json") else None
        if resp.status_code != 200 or not body:
            raise UpstreamError((body or {}).get("message") or resp.text or f"生图服务异常 ({resp.status_code})")
        return body.get("data", body)

    _resolve_openai_img_config()
    task_id = uuid.uuid4().hex
    _SCENE_TASKS[task_id] = {"task_status": "processing"}
    asyncio.create_task(_run_openai_edit_task(task_id, prompt, image_list[0]["image"]))
    return {"task_id": task_id, "task_status": "submitted"}


async def query_scene_gen(task_id: str) -> dict[str, Any]:
    """查询场景生图任务状态"""
    if settings.img_gen_provider == "kling":
        base_url = settings.img_gen_base_url.rstrip("/")
        api_key = settings.img_gen_api_key
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(
                f"{base_url}/v1/images/omni-image/{task_id}",
                headers={"Authorization": f"Bearer {api_key}"},
            )
        body = resp.json() if resp.headers.get("content-type", "").startswith("application/json") else None
        if resp.status_code != 200 or not body:
            raise UpstreamError((body or {}).get("message") or resp.text or f"生图查询异常 ({resp.status_code})")
        inner: dict[str, Any] = body.get("data", body)
        nested_images = (inner.get("task_result") or {}).get("images")
        if nested_images and not inner.get("images"):
            inner["images"] = nested_images
        if inner.get("task_status") == "succeed" and inner.get("images"):
            origin_url = inner["images"][0].get("url")
            if origin_url:
                async with httpx.AsyncClient(timeout=30.0) as client:
                    img_resp = await client.get(origin_url)
                if img_resp.status_code == 200:
                    ct = img_resp.headers.get("content-type", "image/jpeg")
                    public_url, _ = await upload_bytes(
                        img_resp.content, folder="generated", ext=".jpg", content_type=ct
                    )
                    inner["images"] = [{"url": public_url}]
        return inner

    task = _SCENE_TASKS.get(task_id)
    if not task:
        raise NotFound("生图任务不存在")
    if task.get("task_status") != "processing":
        _SCENE_TASKS.pop(task_id, None)
    return task
