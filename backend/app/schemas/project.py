from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Optional
from pydantic import Field

from app.schemas.common import CamelModel


class ProjectCreateIn(CamelModel):
    id: Optional[uuid.UUID] = None
    title: str = Field(default="未命名活动", max_length=200)
    cover_url: Optional[str] = None
    data: dict[str, Any] = Field(default_factory=dict)


class ProjectPatchIn(CamelModel):
    title: Optional[str] = Field(default=None, max_length=200)
    cover_url: Optional[str] = None
    data: Optional[dict[str, Any]] = None


class ProjectListItemOut(CamelModel):
    id: uuid.UUID
    title: str
    cover_url: Optional[str] = None
    data: dict[str, Any]
    create_time: datetime
    update_time: datetime


class ProjectDetailOut(ProjectListItemOut):
    owner_id: uuid.UUID


class ProjectCreateOut(CamelModel):
    id: uuid.UUID
