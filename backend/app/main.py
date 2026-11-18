from __future__ import annotations

from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers.ai import router as ai_router
from app.routers.auth import router as auth_router
from app.routers.media import router as media_router
from app.routers.plaza import router as plaza_router
from app.routers.project import router as project_router
from app.storage.s3 import ensure_bucket


@asynccontextmanager
async def lifespan(_app: FastAPI):
    await ensure_bucket()
    yield


app = FastAPI(
    title="SceneFlow AI API",
    version="0.1.0",
    description="SceneFlow AI 独立后端服务",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)
app.include_router(project_router)
app.include_router(plaza_router)
app.include_router(media_router)
app.include_router(ai_router)


@app.get("/health")
async def health_check() -> dict[str, str]:
    """服务健康检查"""
    return {"status": "ok"}
