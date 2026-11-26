"""Orchestration for AI calls: quota → persisted task → background execution → poll.

Routers stay thin; providers only talk to upstream APIs. Responses keep the
original frontend contracts (vision `retCode`, scene `task_status`).
"""

from __future__ import annotations

from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.image_refs import validate_image_ref
from app.ai.quota import enforce_quota
from app.ai.tasks import create_task_row, get_owned_task, runner, set_task_state
from app.models.profile import Profile
from app.providers import img_gen, vision

# ---- vision ----

VISION_RET_CODE = {"queued": 1, "running": 1, "succeeded": 0, "failed": -1}


async def submit_vision(db: AsyncSession, user: Profile, question: str, image_ref: str) -> str:
    vision.ensure_vision_configured()
    validate_image_ref(image_ref)
    await enforce_quota(db, user, "vision")
    row = await create_task_row(
        db, user, kind="vision", provider="openai", input={"question": question, "imageRef": image_ref}
    )
    await db.commit()

    async def work() -> dict[str, Any]:
        return {"description": await vision.describe_image(question, image_ref)}

    runner.submit(row.id, work)
    return str(row.id)


async def query_vision(db: AsyncSession, user: Profile, task_id: str) -> tuple[int, str]:
    row = await get_owned_task(db, user, task_id, "vision")
    ret_code = VISION_RET_CODE[row.status]
    if row.status == "succeeded":
        return ret_code, (row.result or {}).get("description", "")
    if row.status == "failed":
        return ret_code, f"识图失败：{row.error}"
    return ret_code, ""


# ---- scene image generation ----


async def submit_scene(
    db: AsyncSession,
    user: Profile,
    prompt: str,
    image_refs: list[str],
    resolution: str | None,
    aspect_ratio: str | None,
) -> dict[str, Any]:
    img_gen.ensure_img_gen_configured()
    keys = [validate_image_ref(ref) for ref in image_refs]
    await enforce_quota(db, user, "scene")
    provider = img_gen.provider_name()
    task_input = {"prompt": prompt, "imageRefs": image_refs, "resolution": resolution, "aspectRatio": aspect_ratio}

    if provider == "kling":
        # 上游失败时整个事务回滚：不写任务记录，也不消耗额度
        provider_task_id = await img_gen.kling_submit(prompt, keys, resolution, aspect_ratio)
        row = await create_task_row(db, user, kind="scene", provider=provider, input=task_input, status="running")
        row.provider_task_id = provider_task_id
        await db.commit()
        return {"task_id": str(row.id), "task_status": "submitted"}

    row = await create_task_row(db, user, kind="scene", provider=provider, input=task_input)
    await db.commit()

    async def work() -> dict[str, Any]:
        return {"imageUrl": await img_gen.openai_edit(prompt, image_refs[0])}

    runner.submit(row.id, work)
    return {"task_id": str(row.id), "task_status": "submitted"}


async def query_scene(db: AsyncSession, user: Profile, task_id: str) -> dict[str, Any]:
    row = await get_owned_task(db, user, task_id, "scene")

    if row.provider == "kling" and row.status == "running" and row.provider_task_id:
        status = await img_gen.kling_query(row.provider_task_id)
        if status.done:
            if status.succeeded:
                row.status, row.result = "succeeded", {"imageUrl": status.image_url}
            else:
                row.status, row.error = "failed", status.message
            await db.commit()

    if row.status == "succeeded":
        return {"task_status": "succeed", "images": [{"url": (row.result or {}).get("imageUrl")}]}
    if row.status == "failed":
        return {"task_status": "failed", "task_status_msg": f"生图失败：{row.error}"}
    return {"task_status": "processing"}


# ---- chat (streamed; recorded for quota) ----


async def open_chat_stream(db: AsyncSession, user: Profile, messages: list[dict[str, Any]], **kwargs: Any):
    from app.providers.llm import stream_chat_completions

    await enforce_quota(db, user, "chat")
    row = await create_task_row(
        db, user, kind="chat", provider="openai", input={"messages": len(messages)}, status="running"
    )
    await db.commit()
    try:
        stream = await stream_chat_completions(messages=messages, **kwargs)
    except Exception as exc:
        await set_task_state(row.id, status="failed", error=str(exc)[:500])
        raise
    await set_task_state(row.id, status="succeeded")
    return stream
