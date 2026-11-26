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
    from_user_id: uuid.UUID


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
