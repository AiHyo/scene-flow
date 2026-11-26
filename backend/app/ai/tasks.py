"""Persistent AI task records and the in-process runner that executes them.

Each task's state lives in the `ai_task` table, so any API instance can answer a
poll and a restart no longer loses results. Execution stays in the process that
accepted the request (see design.md §6 for why there is no external queue).
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from collections.abc import Awaitable, Callable
from typing import Any

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import AsyncSessionLocal
from app.core.errors import NotFound
from app.core.logging import get_request_id, set_request_id
from app.models.ai_task import AiTask
from app.models.profile import Profile

logger = logging.getLogger(__name__)

INTERRUPTED_MESSAGE = "服务重启，任务已中断，请重试"
WAIT_IDLE_TIMEOUT_S = 30.0


async def create_task_row(
    db: AsyncSession,
    owner: Profile,
    *,
    kind: str,
    provider: str,
    input: dict[str, Any],
    status: str = "queued",
) -> AiTask:
    row = AiTask(
        owner_id=owner.id,
        kind=kind,
        provider=provider,
        input=input,
        status=status,
        request_id=get_request_id(),
    )
    db.add(row)
    await db.flush()
    return row


async def get_owned_task(db: AsyncSession, owner: Profile, task_id: str, kind: str) -> AiTask:
    """Look up a task by id for its owner only; anything else is a uniform 404."""
    try:
        tid = uuid.UUID(task_id)
    except ValueError as exc:
        raise NotFound("任务不存在") from exc
    row = await db.scalar(select(AiTask).where(AiTask.id == tid, AiTask.owner_id == owner.id, AiTask.kind == kind))
    if row is None:
        raise NotFound("任务不存在")
    return row


async def set_task_state(task_id: uuid.UUID, **values: Any) -> None:
    """Update a task in its own short transaction (used from background work)."""
    async with AsyncSessionLocal() as db:
        await db.execute(update(AiTask).where(AiTask.id == task_id).values(**values))
        await db.commit()


async def recover_interrupted_tasks() -> int:
    """Mark tasks left queued/running by a previous process as failed, so clients
    stop polling instead of waiting forever. Tasks with a provider-side id (Kling)
    are left alone: their state lives at the provider and is still queryable."""
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            update(AiTask)
            .where(AiTask.status.in_(("queued", "running")), AiTask.provider_task_id.is_(None))
            .values(status="failed", error=INTERRUPTED_MESSAGE)
        )
        await db.commit()
        count = result.rowcount or 0
    if count:
        logger.warning("marked %d interrupted AI task(s) as failed", count)
    return count


class TaskRunner:
    """Runs task coroutines in the background and keeps strong references to them
    (asyncio only keeps weak ones, so an unreferenced task can be garbage collected)."""

    def __init__(self) -> None:
        self._tasks: set[asyncio.Task] = set()

    def submit(self, task_id: uuid.UUID, work: Callable[[], Awaitable[dict[str, Any]]]) -> None:
        request_id = get_request_id()

        async def run() -> None:
            set_request_id(request_id)
            await set_task_state(task_id, status="running")
            try:
                result = await work()
            except asyncio.CancelledError:
                await set_task_state(task_id, status="failed", error=INTERRUPTED_MESSAGE)
                raise
            except Exception as exc:
                logger.warning("ai task %s failed: %s", task_id, exc)
                await set_task_state(task_id, status="failed", error=str(exc)[:500] or type(exc).__name__)
            else:
                await set_task_state(task_id, status="succeeded", result=result)

        task = asyncio.create_task(run(), name=f"ai-task-{task_id}")
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    @property
    def pending(self) -> int:
        return len(self._tasks)

    async def wait_idle(self) -> None:
        """Wait until all submitted work has finished (used by tests). Fails loudly
        instead of hanging if something never completes."""
        async with asyncio.timeout(WAIT_IDLE_TIMEOUT_S):
            while self._tasks:
                await asyncio.gather(*list(self._tasks), return_exceptions=True)

    async def shutdown(self) -> None:
        for task in list(self._tasks):
            task.cancel()
        await asyncio.gather(*list(self._tasks), return_exceptions=True)


runner = TaskRunner()
