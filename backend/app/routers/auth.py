from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import get_current_account_user, get_current_user
from app.models.profile import Profile
from app.schemas.auth import (
    AnonLoginIn,
    AuthTokenOut,
    LoginIn,
    MigrateProjectIn,
    MigrateProjectOut,
    ProfilePatchIn,
    RegisterIn,
    UserOut,
)
from app.services import auth_service

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])


@router.post("/anon", response_model=AuthTokenOut)
async def anon_login(body: AnonLoginIn, db: AsyncSession = Depends(get_db)) -> AuthTokenOut:
    """匿名访客会话登录"""
    return await auth_service.anon_login(db, body.credential_id)


@router.post("/register", response_model=AuthTokenOut)
async def register(body: RegisterIn, db: AsyncSession = Depends(get_db)) -> AuthTokenOut:
    """邮箱密码注册"""
    return await auth_service.register_account(db, body)


@router.post("/login", response_model=AuthTokenOut)
async def login(body: LoginIn, db: AsyncSession = Depends(get_db)) -> AuthTokenOut:
    """邮箱密码登录"""
    return await auth_service.login_account(db, body)


@router.get("/me", response_model=UserOut)
async def get_me(user: Profile = Depends(get_current_user)) -> UserOut:
    """获取当前登录用户信息"""
    return UserOut.model_validate(user)


@router.patch("/me", response_model=UserOut)
async def patch_me(
    body: ProfilePatchIn,
    user: Profile = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> UserOut:
    """更新当前用户资料"""
    return await auth_service.update_profile(db, user, body)


@router.post("/migrate-project", response_model=MigrateProjectOut)
async def migrate_project(
    body: MigrateProjectIn,
    user: Profile = Depends(get_current_account_user),
    db: AsyncSession = Depends(get_db),
) -> MigrateProjectOut:
    """登录后把本机访客会话名下项目迁移至当前账号"""
    count = await auth_service.migrate_anon_projects(db, user, body.credential_id)
    return MigrateProjectOut(migrated_count=count)
