"""初始化 6 张核心业务表

Revision ID: 0001_init_schema
Revises:
Create Date: 2026-11-16
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "0001_init_schema"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "profile",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("email", sa.String(length=255), nullable=True),
        sa.Column("password_hash", sa.Text(), nullable=True),
        sa.Column("nickname", sa.String(length=80), nullable=True),
        sa.Column("avatar_url", sa.Text(), nullable=True),
        sa.Column("role", sa.String(length=20), nullable=False, server_default="user"),
        sa.Column("is_anon", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("create_time", sa.DateTime(timezone=True), nullable=False),
        sa.Column("update_time", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_profile_email", "profile", ["email"], unique=True)

    op.create_table(
        "anon_credential_map",
        sa.Column("credential_id", sa.String(length=128), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("profile.id", ondelete="CASCADE"), nullable=False),
        sa.Column("create_time", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_anon_credential_map_user_id", "anon_credential_map", ["user_id"])

    op.create_table(
        "project",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("owner_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("profile.id", ondelete="CASCADE"), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False, server_default="未命名活动"),
        sa.Column("cover_url", sa.Text(), nullable=True),
        sa.Column("data", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("create_time", sa.DateTime(timezone=True), nullable=False),
        sa.Column("update_time", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_project_owner_id", "project", ["owner_id"])
    op.create_index("ix_project_update_time", "project", ["update_time"])

    op.create_table(
        "plaza_post",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("author_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("profile.id", ondelete="CASCADE"), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("img_list", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("author_nickname", sa.String(length=80), nullable=True),
        sa.Column("author_avatar_url", sa.Text(), nullable=True),
        sa.Column("like_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("create_time", sa.DateTime(timezone=True), nullable=False),
        sa.Column("update_time", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_plaza_post_author_id", "plaza_post", ["author_id"])
    op.create_index("ix_plaza_post_create_time", "plaza_post", ["create_time"])

    op.create_table(
        "plaza_like",
        sa.Column("post_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("plaza_post.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("profile.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("create_time", sa.DateTime(timezone=True), nullable=False),
    )

    op.create_table(
        "plaza_comment",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("post_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("plaza_post.id", ondelete="CASCADE"), nullable=False),
        sa.Column("author_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("profile.id", ondelete="CASCADE"), nullable=False),
        sa.Column("author_nickname", sa.String(length=80), nullable=True),
        sa.Column("author_avatar_url", sa.Text(), nullable=True),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("create_time", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_plaza_comment_post_id", "plaza_comment", ["post_id"])
    op.create_index("ix_plaza_comment_author_id", "plaza_comment", ["author_id"])
    op.create_index("ix_plaza_comment_create_time", "plaza_comment", ["create_time"])


def downgrade() -> None:
    op.drop_table("plaza_comment")
    op.drop_table("plaza_like")
    op.drop_table("plaza_post")
    op.drop_table("project")
    op.drop_table("anon_credential_map")
    op.drop_table("profile")
