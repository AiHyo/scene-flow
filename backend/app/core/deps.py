from __future__ import annotations

import uuid
from typing import Optional
from fastapi import Depends, Header, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import decode_access_token
from app.models.profile import Profile


async def get_optional_user(
    authorization: Optional[str] = Header(default=None),
    db: AsyncSession = Depends(get_db),
) -> Optional[Profile]:
    """解析可选的 Bearer JWT，未携带或无效时返回 None"""
    if not authorization or not authorization.startswith("Bearer "):
        return None
    token = authorization[7:].strip()
    if not token:
        return None
    payload = decode_access_token(token)
    if not payload or not payload.get("sub"):
        return None
    try:
        user_id = uuid.UUID(str(payload["sub"]))
    except ValueError:
        return None
    result = await db.execute(select(Profile).where(Profile.id == user_id))
    return result.scalar_one_or_none()


async def get_current_user(
    user: Optional[Profile] = Depends(get_optional_user),
) -> Profile:
    """强制要求有效登录会话（含匿名访客会话）"""
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="未登录或会话已过期",
        )
    return user


async def get_current_account_user(
    user: Profile = Depends(get_current_user),
) -> Profile:
    """强制要求正式注册账号（拒绝匿名访客）"""
    if user.is_anon:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="请先登录正式账号",
        )
    return user
