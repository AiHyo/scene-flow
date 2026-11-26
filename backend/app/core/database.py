from __future__ import annotations

from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.core.config import settings

# pool_timeout：连接池耗尽时快速失败而不是长时间挂起
engine = create_async_engine(settings.database_url, echo=False, pool_pre_ping=True, pool_timeout=10)
AsyncSessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """提供异步数据库会话"""
    async with AsyncSessionLocal() as session:
        yield session
