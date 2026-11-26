from __future__ import annotations

import uuid

from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import Forbidden, NotFound
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


async def update_project(db: AsyncSession, user: Profile, project_id: uuid.UUID, body: ProjectPatchIn) -> Project:
    """更新活动项目"""
    project = await get_owned_project(db, user, project_id)
    patch = body.model_dump(exclude_unset=True)
    for key, val in patch.items():
        setattr(project, key, val)
    await db.commit()
    await db.refresh(project)
    return project


async def delete_project(db: AsyncSession, user: Profile, project_id: uuid.UUID) -> None:
    """删除活动项目"""
    project = await get_owned_project(db, user, project_id)
    await db.delete(project)
    await db.commit()
