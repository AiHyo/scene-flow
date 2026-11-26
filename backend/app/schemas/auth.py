from __future__ import annotations

import uuid

from pydantic import EmailStr, Field

from app.schemas.common import CamelModel


class AnonLoginIn(CamelModel):
    credential_id: str = Field(min_length=8, max_length=128)


class RegisterIn(CamelModel):
    email: EmailStr
    password: str = Field(min_length=6, max_length=128)
    nickname: str | None = Field(default=None, max_length=80)


class LoginIn(CamelModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


class ProfilePatchIn(CamelModel):
    nickname: str | None = Field(default=None, max_length=80)
    avatar_url: str | None = None


class MigrateProjectIn(CamelModel):
    # 访客凭证（浏览器本地保存的 anon_credential_id）。持有凭证即证明拥有该访客身份；
    # 不再接受裸用户 ID，否则任何知道访客 UUID 的人都能转走其项目。
    credential_id: str = Field(min_length=8, max_length=128)


class UserOut(CamelModel):
    id: uuid.UUID
    email: str | None = None
    nickname: str | None = None
    avatar_url: str | None = None
    role: str
    is_anon: bool


class AuthTokenOut(CamelModel):
    access_token: str
    user: UserOut


class MigrateProjectOut(CamelModel):
    migrated_count: int
