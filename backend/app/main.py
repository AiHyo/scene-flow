from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.ai.image_refs import seed_sample_venues
from app.ai.tasks import recover_interrupted_tasks, runner
from app.core.config import settings
from app.core.errors import AppError
from app.core.http import close_http_client, start_http_client
from app.core.logging import RequestIdMiddleware, configure_logging
from app.routers.ai import router as ai_router
from app.routers.ai_plan import router as ai_plan_router
from app.routers.auth import router as auth_router
from app.routers.media import router as media_router
from app.routers.plaza import router as plaza_router
from app.routers.project import router as project_router
from app.storage import get_storage

configure_logging(settings.log_level)
logger = logging.getLogger("app")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    await start_http_client()
    await get_storage().ensure_ready()
    try:
        await seed_sample_venues()
    except Exception:
        logger.warning("seeding sample venue images failed; sample venues will be unavailable", exc_info=True)
    await recover_interrupted_tasks()
    try:
        yield
    finally:
        await runner.shutdown()
        await close_http_client()


app = FastAPI(
    title="SceneFlow AI API",
    version="0.1.0",
    description="SceneFlow AI 独立后端服务",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    # 前端通过 Authorization 头携带 Bearer token，不依赖 Cookie，因此无需凭证模式
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Request-ID", "Retry-After"],
)
# 最外层：保证 CORS 预检与错误响应也带 request id
app.add_middleware(RequestIdMiddleware)


@app.exception_handler(AppError)
async def handle_app_error(_request: Request, exc: AppError) -> JSONResponse:
    if exc.status_code >= 500:
        logger.warning("%s: %s", exc.code, exc.message)
    return JSONResponse(status_code=exc.status_code, content=exc.to_body(), headers=exc.headers or None)


# 未处理异常由 RequestIdMiddleware 兜底为 500 JSON（保留 request id），见 app/core/logging.py


app.include_router(auth_router)
app.include_router(project_router)
app.include_router(plaza_router)
app.include_router(media_router)
app.include_router(ai_router)
app.include_router(ai_plan_router)


@app.get("/health")
async def health_check() -> dict[str, str]:
    """服务健康检查"""
    return {"status": "ok"}
