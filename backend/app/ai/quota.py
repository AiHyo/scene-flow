"""Per-user rate limits, using `ai_task` rows as the usage ledger.

No Redis: counting a user's rows in the last window uses the
(owner_id, kind, created_at) index and stays correct across API instances.
A transaction-scoped advisory lock per (user, kind) makes "count then insert"
atomic, so a burst of parallel requests cannot slip past the limit.
"""

from __future__ import annotations

import math
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.errors import RateLimited
from app.models.ai_task import AiTask
from app.models.profile import Profile

WINDOW = timedelta(hours=1)
LOCK_WAIT_MS = 5000


def limit_for(user: Profile, kind: str) -> int:
    tier = "guest" if user.is_anon else "account"
    return getattr(settings, f"quota_{kind}_{tier}_per_hour")


async def enforce_quota(db: AsyncSession, user: Profile, kind: str) -> None:
    """Raise RateLimited if the user is at their limit. Must run in the same
    transaction that then inserts the new ai_task row."""
    # 限时等待：同一用户的并发请求排队，最多等 LOCK_WAIT；超时视为过载返回 429，绝不无限挂起
    await db.execute(text(f"SET LOCAL lock_timeout = '{LOCK_WAIT_MS}ms'"))
    try:
        await db.execute(
            text("SELECT pg_advisory_xact_lock(hashtext(:k))"),
            {"k": f"ai-quota:{user.id}:{kind}"},
        )
    except DBAPIError as exc:
        if "lock timeout" not in str(exc).lower():
            raise
        raise RateLimited("请求过于密集，请稍后再试", retry_after=1) from exc
    since = datetime.now(UTC) - WINDOW
    count, oldest = (
        await db.execute(
            select(func.count(), func.min(AiTask.created_at)).where(
                AiTask.owner_id == user.id, AiTask.kind == kind, AiTask.created_at > since
            )
        )
    ).one()
    limit = limit_for(user, kind)
    if count >= limit:
        retry_after = max(1, math.ceil((oldest + WINDOW - datetime.now(UTC)).total_seconds()))
        raise RateLimited(f"调用过于频繁，请 {retry_after} 秒后再试", retry_after=retry_after)
