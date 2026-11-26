from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.core.deps import get_current_user
from app.models.profile import Profile
from app.providers.img_gen import query_scene_gen, submit_scene_gen
from app.providers.llm import stream_chat_completions
from app.providers.vision import query_vision_task, submit_vision_task
from app.schemas.common import CamelModel

router = APIRouter(prefix="/api/v1/ai", tags=["ai"])


class ChatIn(BaseModel):
    messages: list[dict[str, Any]] = Field(min_length=1)
    model: str | None = None
    enable_thinking: bool = False


class VisionRequestIn(CamelModel):
    question: str = Field(min_length=1, max_length=200)
    url: str = Field(min_length=1)


class VisionRequestOut(CamelModel):
    task_id: str


class VisionResultIn(CamelModel):
    task_id: str = Field(min_length=1)


class VisionResultOut(CamelModel):
    ret_code: int
    description: str


class SceneSubmitIn(BaseModel):
    prompt: str = Field(min_length=1)
    image_list: list[dict[str, str]] = Field(min_length=1)
    resolution: str | None = None
    aspect_ratio: str | None = None


class SceneQueryIn(BaseModel):
    task_id: str = Field(min_length=1)


@router.post("/chat")
async def ai_chat(
    body: ChatIn,
    _user: Profile = Depends(get_current_user),
) -> StreamingResponse:
    """AI 策划对话 SSE 流式代理"""
    stream = await stream_chat_completions(
        messages=body.messages,
        model=body.model,
        enable_thinking=body.enable_thinking,
    )
    return StreamingResponse(stream, media_type="text/event-stream")


@router.post("/vision/request", response_model=VisionRequestOut)
async def vision_request(
    body: VisionRequestIn,
    _user: Profile = Depends(get_current_user),
) -> VisionRequestOut:
    """提交场地图像理解任务"""
    task_id = submit_vision_task(body.question, body.url)
    return VisionRequestOut(task_id=task_id)


@router.post("/vision/result", response_model=VisionResultOut)
async def vision_result(
    body: VisionResultIn,
    _user: Profile = Depends(get_current_user),
) -> VisionResultOut:
    """查询图像理解任务结果"""
    res = query_vision_task(body.task_id)
    return VisionResultOut(ret_code=res["retCode"], description=res["description"])


@router.post("/scene/submit")
async def scene_submit(
    body: SceneSubmitIn,
    _user: Profile = Depends(get_current_user),
) -> dict[str, Any]:
    """提交场景布置生图任务"""
    valid_imgs = [it for it in body.image_list if isinstance(it.get("image"), str) and it["image"].startswith("http")]
    if not valid_imgs:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="缺少有效的场地底图 URL")
    return await submit_scene_gen(
        prompt=body.prompt,
        image_list=valid_imgs,
        resolution=body.resolution,
        aspect_ratio=body.aspect_ratio,
    )


@router.post("/scene/query")
async def scene_query(
    body: SceneQueryIn,
    _user: Profile = Depends(get_current_user),
) -> dict[str, Any]:
    """查询场景生图任务状态"""
    return await query_scene_gen(body.task_id)
