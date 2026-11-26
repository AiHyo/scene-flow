from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import Field

from app.schemas.common import CamelModel


class PlazaPostCreateIn(CamelModel):
    title: str = Field(min_length=1, max_length=200)
    content: str = Field(min_length=1)
    img_list: list[str] = Field(default_factory=list)


class PlazaCommentCreateIn(CamelModel):
    content: str = Field(min_length=1, max_length=2000)


class PlazaCommentOut(CamelModel):
    id: uuid.UUID
    post_id: uuid.UUID
    author_id: uuid.UUID
    author_nickname: str | None = None
    author_avatar_url: str | None = None
    content: str
    create_time: datetime


class PlazaPostOut(CamelModel):
    id: uuid.UUID
    author_id: uuid.UUID
    title: str
    content: str
    img_list: list[str]
    author_nickname: str | None = None
    author_avatar_url: str | None = None
    like_count: int
    liked_by_me: bool = False
    create_time: datetime
    update_time: datetime


class PlazaPostDetailOut(PlazaPostOut):
    comment_list: list[PlazaCommentOut] = Field(default_factory=list)


class PlazaLikeOut(CamelModel):
    liked: bool
    like_count: int
