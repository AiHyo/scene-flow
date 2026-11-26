from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from pydantic import Field

from app.schemas.common import CamelModel


class ProjectCreateIn(CamelModel):
    id: uuid.UUID | None = None
    title: str = Field(default="未命名活动", max_length=200)
    cover_url: str | None = None
    data: dict[str, Any] = Field(default_factory=dict)


class ProjectPatchIn(CamelModel):
    title: str | None = Field(default=None, max_length=200)
    cover_url: str | None = None
    data: dict[str, Any] | None = None
    # 乐观锁：提供时仅当服务端版本一致才写入，否则 409；省略时无条件写入（如列表页改名）
    expected_version: int | None = Field(default=None, ge=1)


class ProjectPatchOut(CamelModel):
    version: int


class ProjectListItemOut(CamelModel):
    id: uuid.UUID
    title: str
    cover_url: str | None = None
    data: dict[str, Any]
    version: int
    create_time: datetime
    update_time: datetime


class ProjectDetailOut(ProjectListItemOut):
    owner_id: uuid.UUID


class ProjectCreateOut(CamelModel):
    id: uuid.UUID
