"""AI co-planning endpoints. The client sends data (project snapshot, what the user
said, options); the server owns every prompt and picks the model. Unknown fields such
as `messages` or `model` are rejected with 422."""

from __future__ import annotations

import json
from typing import Any, Literal

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from pydantic import ConfigDict, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai import plan
from app.ai.assemble import ChatOptions, InspirationHint, PartnerHint
from app.core.database import get_db
from app.core.deps import get_current_user
from app.core.errors import PayloadTooLarge
from app.models.profile import Profile
from app.schemas.common import CamelModel

router = APIRouter(prefix="/api/v1/ai/plan", tags=["ai-plan"])

MAX_PROJECT_BYTES = 256 * 1024


class _In(CamelModel):
    model_config = ConfigDict(extra="forbid")


class PartnerHintIn(_In):
    name: str = Field(max_length=80)
    use: str = Field(max_length=300)
    scenes: str = Field(max_length=120)


class InspirationHintIn(_In):
    title: str = Field(max_length=80)
    how_to: str = Field(max_length=600)
    format: str = Field(max_length=120)
    needs: str = Field(max_length=300)


class PlanChatIn(_In):
    project: dict[str, Any]
    user_text: str = Field(default="", max_length=4000)
    vision: str | None = Field(default=None, max_length=4000)
    detail: Literal["brief", "medium", "detailed"] = "medium"
    nickname: str | None = Field(default=None, max_length=40)
    mem_only: bool = False
    no_scene: bool = False
    partner_hints: list[PartnerHintIn] = Field(default_factory=list, max_length=5)
    inspiration_hints: list[InspirationHintIn] = Field(default_factory=list, max_length=5)


class PlanModeIn(_In):
    project: dict[str, Any]
    user_text: str = Field(default="", max_length=4000)
    nickname: str | None = Field(default=None, max_length=40)


def _check_size(project: dict[str, Any]) -> None:
    if len(json.dumps(project, ensure_ascii=False).encode("utf-8")) > MAX_PROJECT_BYTES:
        raise PayloadTooLarge("项目数据过大")


@router.post("/chat")
async def plan_chat(
    body: PlanChatIn,
    user: Profile = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> StreamingResponse:
    """AI 共策对话（SSE，OpenAI chunk 格式）"""
    _check_size(body.project)
    opts = ChatOptions(
        detail=body.detail,
        nickname=body.nickname,
        mem_only=body.mem_only,
        no_scene=body.no_scene,
        vision=body.vision,
        partners=[PartnerHint(name=h.name, use=h.use, scenes=h.scenes) for h in body.partner_hints],
        inspirations=[
            InspirationHint(title=h.title, how_to=h.how_to, format=h.format, needs=h.needs)
            for h in body.inspiration_hints
        ],
    )
    stream = await plan.open_plan_chat(db, user, body.project, body.user_text, opts)
    return StreamingResponse(stream, media_type="text/event-stream")


@router.post("/{mode}")
async def plan_generate(
    mode: Literal["directions", "theme", "scheme", "copies"],
    body: PlanModeIn,
    user: Profile = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """结构化生成：方向 / 主题 / 完整方案 / 文案。返回 {mode, data, promptVersion}"""
    _check_size(body.project)
    return await plan.generate(db, user, mode, body.project, body.user_text, body.nickname)
