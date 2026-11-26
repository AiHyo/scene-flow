from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import desc, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import Conflict, Forbidden, NotFound
from app.models.profile import Profile
from app.models.project import Project
from app.schemas.project import ProjectCreateIn, ProjectPatchIn


async def list_projects(db: AsyncSession, user: Profile, limit: int = 24, offset: int = 0) -> list[Project]:
    """查询当前用户名下的活动项目列表"""
    result = await db.execute(
        select(Project)
        .where(Project.owner_id == user.id)
        .order_by(desc(Project.update_time))
        .limit(limit)
        .offset(offset)
    )
    return list(result.scalars().all())


async def create_project(db: AsyncSession, user: Profile, body: ProjectCreateIn) -> Project:
    """创建活动项目"""
    project = Project(
        id=body.id or uuid.uuid4(),
        owner_id=user.id,
        title=body.title,
        cover_url=body.cover_url,
        data=body.data,
    )
    db.add(project)
    await db.commit()
    await db.refresh(project)
    return project


async def get_owned_project(db: AsyncSession, user: Profile, project_id: uuid.UUID) -> Project:
    """获取项目并校验归属权"""
    result = await db.execute(select(Project).where(Project.id == project_id))
    project = result.scalar_one_or_none()
    if not project:
        raise NotFound("项目不存在")
    if project.owner_id != user.id:
        raise Forbidden("无权访问该项目")
    return project


async def update_project(db: AsyncSession, user: Profile, project_id: uuid.UUID, body: ProjectPatchIn) -> int:
    """更新活动项目，返回新版本号。

    版本校验与写入在同一条 UPDATE 中完成（WHERE version = :expected），
    没有「先读再写」的竞争窗口：两个窗口同时提交时只有一个能成功。
    """
    await get_owned_project(db, user, project_id)  # 先区分 404 / 403
    patch = body.model_dump(exclude_unset=True, exclude={"expected_version"})

    stmt = update(Project).where(Project.id == project_id, Project.owner_id == user.id)
    if body.expected_version is not None:
        stmt = stmt.where(Project.version == body.expected_version)
    new_version = await db.scalar(
        stmt.values(**patch, version=Project.version + 1, update_time=datetime.now(UTC))
        .returning(Project.version)
        .execution_options(synchronize_session=False)
    )
    if new_version is None:
        await db.rollback()
        current = await db.scalar(select(Project.version).where(Project.id == project_id))
        raise Conflict("活动已在其他窗口更新", code="version_conflict", extra={"currentVersion": current})
    await db.commit()
    return new_version


async def delete_project(db: AsyncSession, user: Profile, project_id: uuid.UUID) -> None:
    """删除活动项目"""
    project = await get_owned_project(db, user, project_id)
    await db.delete(project)
    await db.commit()
