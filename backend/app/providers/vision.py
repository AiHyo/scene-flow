from __future__ import annotations

import asyncio
import base64
import uuid
from typing import Any

import httpx
from fastapi import HTTPException, status

from app.core.config import settings

# 轻量内存任务表，将异步轮询接口适配为单次多模态视觉模型调用
_VISION_TASKS: dict[str, dict[str, Any]] = {}


async def _to_data_url(image_url: str) -> str:
    """下载图片并转为 base64 data URL，避免上游无法访问本地/内网 MinIO 地址"""
    if image_url.startswith("data:"):
        return image_url
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.get(image_url)
    if resp.status_code != 200 or not resp.content:
        raise RuntimeError(f"无法读取待识别图片（HTTP {resp.status_code}）")
    ct = resp.headers.get("content-type", "image/jpeg").split(";")[0].strip()
    b64 = base64.b64encode(resp.content).decode("ascii")
    return f"data:{ct};base64,{b64}"


async def _run_vision_task(task_id: str, question: str, image_url: str) -> None:
    base_url = (settings.vision_base_url or settings.llm_base_url).rstrip("/")
    api_key = settings.vision_api_key or settings.llm_api_key
    model = settings.vision_model or settings.llm_vision_model

    headers = {"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"}

    try:
        data_url = await _to_data_url(image_url)
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
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(f"{base_url}/chat/completions", headers=headers, json=payload)
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


def submit_vision_task(question: str, image_url: str) -> str:
    """提交图像理解任务并后台执行"""
    api_key = settings.vision_api_key or settings.llm_api_key
    if not api_key:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="服务端未配置 VISION_API_KEY 或 LLM_API_KEY",
        )
    task_id = uuid.uuid4().hex
    _VISION_TASKS[task_id] = {"retCode": 1, "description": ""}
    asyncio.create_task(_run_vision_task(task_id, question, image_url))
    return task_id


def query_vision_task(task_id: str) -> dict[str, Any]:
    """查询图像理解任务状态（0 成功，1 处理中，-1 失败）"""
    task = _VISION_TASKS.get(task_id)
    if not task:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="识图任务不存在")
    if task["retCode"] != 1:
        _VISION_TASKS.pop(task_id, None)
    return task
