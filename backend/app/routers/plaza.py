from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import get_current_account_user, get_optional_user
from app.models.profile import Profile
from app.schemas.plaza import (
    PlazaCommentCreateIn,
    PlazaCommentOut,
    PlazaLikeOut,
    PlazaPostCreateIn,
    PlazaPostDetailOut,
    PlazaPostOut,
)
from app.services import plaza_service

router = APIRouter(prefix="/api/v1", tags=["plaza"])


@router.get("/plaza-post", response_model=list[PlazaPostOut])
async def list_posts(
    limit: int = Query(default=24, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    user: Profile | None = Depends(get_optional_user),
    db: AsyncSession = Depends(get_db),
) -> list[PlazaPostOut]:
    """公开浏览活动广场动态列表"""
    return await plaza_service.list_posts(db, user, limit=limit, offset=offset)


@router.post("/plaza-post", response_model=PlazaPostOut, status_code=status.HTTP_201_CREATED)
async def create_post(
    body: PlazaPostCreateIn,
    user: Profile = Depends(get_current_account_user),
    db: AsyncSession = Depends(get_db),
) -> PlazaPostOut:
    """发布活动广场动态（仅正式登录账号）"""
    return await plaza_service.create_post(db, user, body)


@router.get("/plaza-post/{post_id}", response_model=PlazaPostDetailOut)
async def get_post_detail(
    post_id: uuid.UUID,
    user: Profile | None = Depends(get_optional_user),
    db: AsyncSession = Depends(get_db),
) -> PlazaPostDetailOut:
    """获取动态详情及评论"""
    return await plaza_service.get_post_detail(db, user, post_id)


@router.delete("/plaza-post/{post_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_post(
    post_id: uuid.UUID,
    user: Profile = Depends(get_current_account_user),
    db: AsyncSession = Depends(get_db),
) -> Response:
    """删除本人发布的动态"""
    await plaza_service.delete_post(db, user, post_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/plaza-post/{post_id}/like", response_model=PlazaLikeOut)
async def toggle_like(
    post_id: uuid.UUID,
    user: Profile = Depends(get_current_account_user),
    db: AsyncSession = Depends(get_db),
) -> PlazaLikeOut:
    """点赞或取消点赞"""
    return await plaza_service.toggle_like(db, user, post_id)


@router.post("/plaza-post/{post_id}/comment", response_model=PlazaCommentOut, status_code=status.HTTP_201_CREATED)
async def create_comment(
    post_id: uuid.UUID,
    body: PlazaCommentCreateIn,
    user: Profile = Depends(get_current_account_user),
    db: AsyncSession = Depends(get_db),
) -> PlazaCommentOut:
    """发表单级评论"""
    return await plaza_service.create_comment(db, user, post_id, body)


@router.delete("/plaza-comment/{comment_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_comment(
    comment_id: uuid.UUID,
    user: Profile = Depends(get_current_account_user),
    db: AsyncSession = Depends(get_db),
) -> Response:
    """删除本人评论"""
    await plaza_service.delete_comment(db, user, comment_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
