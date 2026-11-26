from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base

TASK_KINDS = ("chat", "vision", "scene")
TASK_STATUSES = ("queued", "running", "succeeded", "failed")


def _utcnow() -> datetime:
    return datetime.now(UTC)


class AiTask(Base):
    """AI 调用记录：异步任务的状态，同时是限流用的用量账本。"""

    __tablename__ = "ai_task"
    __table_args__ = (
        CheckConstraint(f"kind IN {TASK_KINDS}", name="ck_ai_task_kind"),
        CheckConstraint(f"status IN {TASK_STATUSES}", name="ck_ai_task_status"),
        Index("ix_ai_task_owner_kind_created", "owner_id", "kind", "created_at"),
        Index("ix_ai_task_status", "status"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    owner_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("profile.id", ondelete="CASCADE"), nullable=False
    )
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="queued")
    provider: Mapped[str] = mapped_column(String(32), nullable=False)
    provider_task_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    input: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    result: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    request_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow, onupdate=_utcnow
    )
