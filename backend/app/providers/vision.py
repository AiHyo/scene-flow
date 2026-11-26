from __future__ import annotations

import asyncio
import base64
import uuid
from typing import Any

import httpx

from app.ai.image_refs import resolve_image_ref, validate_image_ref
from app.core.config import settings
from app.core.errors import NotFound, ServiceMisconfigured
from app.core.http import get_http_client

# 轻量内存任务表，将异步轮询接口适配为单次多模态视觉模型调用（下一步改为数据库持久化）
_VISION_TASKS: dict[str, dict[str, Any]] = {}
_RUNNING: set[asyncio.Task] = set()

VISION_TIMEOUT = httpx.Timeout(connect=15.0, read=60.0, write=30.0, pool=15.0)


async def _run_vision_task(task_id: str, question: str, image_ref: str) -> None:
    base_url = (settings.vision_base_url or settings.llm_base_url).rstrip("/")
    api_key = settings.vision_api_key or settings.llm_api_key
    model = settings.vision_model or settings.llm_vision_model
    headers = {"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"}

    try:
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
        resp = await get_http_client().post(
            f"{base_url}/chat/completions", headers=headers, json=payload, timeout=VISION_TIMEOUT
        )
        if resp.status_code != 200:
            _VISION_TASKS[task_id] = {
                "retCode": -1,
                "description": f"识图服务异常 ({resp.status_code}): {resp.text[:200]}",
            }
            return
        data = resp.json()
        content = data.get("choices", [{}])[0].get("message", {}).get("content", "")
        _VISION_TASKS[task_id] = {"retCode": 0, "description": content}
    except Exception as exc:
        _VISION_TASKS[task_id] = {"retCode": -1, "description": f"识图请求失败: {exc}"}


def submit_vision_task(question: str, image_ref: str) -> str:
    """提交图像理解任务并后台执行"""
    api_key = settings.vision_api_key or settings.llm_api_key
    if not api_key:
        raise ServiceMisconfigured("服务端未配置 VISION_API_KEY 或 LLM_API_KEY")
    validate_image_ref(image_ref)  # 非法引用在提交阶段直接 400
    task_id = uuid.uuid4().hex
    _VISION_TASKS[task_id] = {"retCode": 1, "description": ""}
    task = asyncio.create_task(_run_vision_task(task_id, question, image_ref))
    _RUNNING.add(task)
    task.add_done_callback(_RUNNING.discard)
    return task_id


def query_vision_task(task_id: str) -> dict[str, Any]:
    """查询图像理解任务状态（0 成功，1 处理中，-1 失败）"""
    task = _VISION_TASKS.get(task_id)
    if not task:
        raise NotFound("识图任务不存在")
    if task["retCode"] != 1:
        _VISION_TASKS.pop(task_id, None)
    return task
