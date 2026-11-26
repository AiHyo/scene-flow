from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai import service
from app.ai.providers import ai_mode
from app.core.database import get_db
from app.core.deps import get_current_user
from app.core.errors import BadRequest
from app.models.profile import Profile
from app.schemas.common import CamelModel

router = APIRouter(prefix="/api/v1/ai", tags=["ai"])


class VisionRequestIn(CamelModel):
    question: str = Field(min_length=1, max_length=200)
    url: str = Field(min_length=1, max_length=2048)


class VisionRequestOut(CamelModel):
    task_id: str


class VisionResultIn(CamelModel):
    task_id: str = Field(min_length=1, max_length=64)


class VisionResultOut(CamelModel):
    ret_code: int
    description: str


class SceneSubmitIn(BaseModel):
    prompt: str = Field(min_length=1)
    image_list: list[dict[str, str]] = Field(min_length=1)
    resolution: str | None = None
    aspect_ratio: str | None = None


class SceneQueryIn(BaseModel):
    task_id: str = Field(min_length=1, max_length=64)


class AIStatusOut(CamelModel):
    mode: str  # live | demo


@router.get("/status", response_model=AIStatusOut)
async def ai_status() -> AIStatusOut:
    """当前 AI 运行模式：live（真实模型）/ demo（未配置密钥，使用预置示例）"""
    return AIStatusOut(mode=ai_mode())


@router.post("/vision/request", response_model=VisionRequestOut)
async def vision_request(
    body: VisionRequestIn,
    user: Profile = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> VisionRequestOut:
    """提交场地图像理解任务"""
    task_id = await service.submit_vision(db, user, body.question, body.url)
    return VisionRequestOut(task_id=task_id)


@router.post("/vision/result", response_model=VisionResultOut)
async def vision_result(
    body: VisionResultIn,
    user: Profile = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> VisionResultOut:
    """查询图像理解任务结果（0 成功，1 处理中，-1 失败）"""
    ret_code, description = await service.query_vision(db, user, body.task_id)
    return VisionResultOut(ret_code=ret_code, description=description)


@router.post("/scene/submit")
async def scene_submit(
    body: SceneSubmitIn,
    user: Profile = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """提交场景布置生图任务（底图须为本站上传图片或内置样例场地）"""
    refs = [it["image"].strip() for it in body.image_list if isinstance(it.get("image"), str) and it["image"].strip()]
    if not refs:
        raise BadRequest("缺少有效的场地底图")
    return await service.submit_scene(db, user, body.prompt, refs, body.resolution, body.aspect_ratio)


@router.post("/scene/query")
async def scene_query(
    body: SceneQueryIn,
    user: Profile = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """查询场景生图任务状态"""
    return await service.query_scene(db, user, body.task_id)
