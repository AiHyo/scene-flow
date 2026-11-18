from __future__ import annotations

import uuid
from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.profile import Profile
from app.schemas.project import (
    ProjectCreateIn,
    ProjectCreateOut,
    ProjectDetailOut,
    ProjectListItemOut,
    ProjectPatchIn,
)
from app.services import project_service

router = APIRouter(prefix="/api/v1/project", tags=["project"])


@router.get("", response_model=list[ProjectListItemOut])
async def list_projects(
    limit: int = Query(default=24, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    user: Profile = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[ProjectListItemOut]:
    """获取当前用户的活动项目列表"""
    items = await project_service.list_projects(db, user, limit=limit, offset=offset)
    return [ProjectListItemOut.model_validate(it) for it in items]


@router.post("", response_model=ProjectCreateOut, status_code=status.HTTP_201_CREATED)
async def create_project(
    body: ProjectCreateIn,
    user: Profile = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ProjectCreateOut:
    """创建活动项目"""
    project = await project_service.create_project(db, user, body)
    return ProjectCreateOut(id=project.id)


@router.get("/{project_id}", response_model=ProjectDetailOut)
async def get_project(
    project_id: uuid.UUID,
    user: Profile = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ProjectDetailOut:
    """获取单个活动项目详情"""
    project = await project_service.get_owned_project(db, user, project_id)
    return ProjectDetailOut.model_validate(project)


@router.patch("/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
async def update_project(
    project_id: uuid.UUID,
    body: ProjectPatchIn,
    user: Profile = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Response:
    """局部更新活动项目"""
    await project_service.update_project(db, user, project_id, body)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete("/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_project(
    project_id: uuid.UUID,
    user: Profile = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Response:
    """删除活动项目"""
    await project_service.delete_project(db, user, project_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
