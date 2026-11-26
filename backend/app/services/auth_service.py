from __future__ import annotations

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import Conflict, Forbidden, Unauthorized
from app.core.security import create_access_token, hash_password, verify_password
from app.models.profile import AnonCredentialMap, Profile
from app.models.project import Project
from app.schemas.auth import AuthTokenOut, LoginIn, ProfilePatchIn, RegisterIn, UserOut


def _build_token_response(user: Profile) -> AuthTokenOut:
    token = create_access_token(str(user.id), is_anon=user.is_anon)
    return AuthTokenOut(access_token=token, user=UserOut.model_validate(user))


async def anon_login(db: AsyncSession, credential_id: str) -> AuthTokenOut:
    """按本地访客凭证登录，不存在时自动创建匿名档案"""
    result = await db.execute(select(AnonCredentialMap).where(AnonCredentialMap.credential_id == credential_id))
    mapping = result.scalar_one_or_none()
    if mapping:
        user_res = await db.execute(select(Profile).where(Profile.id == mapping.user_id))
        user = user_res.scalar_one_or_none()
        if user:
            return _build_token_response(user)

    user = Profile(is_anon=True, role="user")
    db.add(user)
    await db.flush()
    db.add(AnonCredentialMap(credential_id=credential_id, user_id=user.id))
    await db.commit()
    await db.refresh(user)
    return _build_token_response(user)


async def register_account(db: AsyncSession, body: RegisterIn) -> AuthTokenOut:
    """邮箱密码注册"""
    email = body.email.strip().lower()
    existing = await db.execute(select(Profile.id).where(Profile.email == email))
    if existing.scalar_one_or_none() is not None:
        raise Conflict("该邮箱已被注册")

    user = Profile(
        email=email,
        password_hash=hash_password(body.password),
        nickname=body.nickname.strip() if body.nickname else None,
        is_anon=False,
        role="user",
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return _build_token_response(user)


async def login_account(db: AsyncSession, body: LoginIn) -> AuthTokenOut:
    """邮箱密码登录"""
    email = body.email.strip().lower()
    result = await db.execute(select(Profile).where(Profile.email == email))
    user = result.scalar_one_or_none()
    if not user or not user.password_hash or not verify_password(body.password, user.password_hash):
        raise Unauthorized("邮箱或密码错误")
    return _build_token_response(user)


async def update_profile(db: AsyncSession, user: Profile, body: ProfilePatchIn) -> UserOut:
    """更新当前用户昵称或头像"""
    patch = body.model_dump(exclude_unset=True)
    if "nickname" in patch and patch["nickname"] is not None:
        patch["nickname"] = patch["nickname"].strip() or None
    for key, val in patch.items():
        setattr(user, key, val)
    await db.commit()
    await db.refresh(user)
    return UserOut.model_validate(user)


async def migrate_anon_projects(db: AsyncSession, target_user: Profile, credential_id: str) -> int:
    """将访客名下的活动项目迁移到当前正式账号。

    所有权证明是访客凭证本身（只保存在该访客的浏览器里），而不是可能泄露的用户 ID。
    凭证无效、或对应的不是访客账号时统一返回 403，不区分原因，避免被用来探测。
    """
    src_user = await db.scalar(
        select(Profile)
        .join(AnonCredentialMap, AnonCredentialMap.user_id == Profile.id)
        .where(AnonCredentialMap.credential_id == credential_id)
    )
    if not src_user or not src_user.is_anon:
        raise Forbidden("无法验证访客身份，项目未迁移")
    if src_user.id == target_user.id:
        return 0

    result = await db.execute(
        update(Project).where(Project.owner_id == src_user.id).values(owner_id=target_user.id).returning(Project.id)
    )
    migrated_ids = result.scalars().all()
    await db.commit()
    return len(migrated_ids)
