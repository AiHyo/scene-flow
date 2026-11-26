"""Orchestration for AI calls: quota → persisted task → background execution → poll.

Routers stay thin; providers only talk to upstream APIs and never see user URLs
(images are resolved here through the SSRF-safe `image_refs`). Responses keep the
original frontend contracts (vision `retCode`, scene `task_status`).
"""

from __future__ import annotations

from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.image_refs import resolve_image_ref, validate_image_ref
from app.ai.providers import get_providers
from app.ai.quota import enforce_quota
from app.ai.tasks import create_task_row, get_owned_task, runner, set_task_state
from app.models.profile import Profile
from app.storage import get_storage
from app.storage.base import public_url, upload

# ---- vision ----

VISION_RET_CODE = {"queued": 1, "running": 1, "succeeded": 0, "failed": -1}


async def submit_vision(db: AsyncSession, user: Profile, question: str, image_ref: str) -> str:
    providers = get_providers()
    validate_image_ref(image_ref)
    await enforce_quota(db, user, "vision")
    row = await create_task_row(
        db, user, kind="vision", provider=providers.vision.name, input={"question": question, "imageRef": image_ref}
    )
    await db.commit()

    async def work() -> dict[str, Any]:
        image = await resolve_image_ref(image_ref)
        return {"description": await providers.vision.describe(question, image)}

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


async def _store_generated(data: bytes) -> str:
    is_png = data.startswith(b"\x89PNG")
    url, _ = await upload(
        get_storage(),
        data,
        folder="generated",
        ext=".png" if is_png else ".jpg",
        content_type="image/png" if is_png else "image/jpeg",
    )
    return url


async def submit_scene(
    db: AsyncSession,
    user: Profile,
    prompt: str,
    image_refs: list[str],
    resolution: str | None,
    aspect_ratio: str | None,
) -> dict[str, Any]:
    providers = get_providers()
    image_provider = providers.image
    keys = [validate_image_ref(ref) for ref in image_refs]
    await enforce_quota(db, user, "scene")
    task_input = {"prompt": prompt, "imageRefs": image_refs, "resolution": resolution, "aspectRatio": aspect_ratio}

    if image_provider.is_async:
        # 上游自行拉图：只交出已校验对象的本桶公开地址。上游失败时整个事务回滚，不消耗额度
        storage = get_storage()
        provider_task_id = await image_provider.submit(
            prompt, [public_url(storage, k) for k in keys], resolution, aspect_ratio
        )
        row = await create_task_row(
            db, user, kind="scene", provider=image_provider.name, input=task_input, status="running"
        )
        row.provider_task_id = provider_task_id
        await db.commit()
        return {"task_id": str(row.id), "task_status": "submitted"}

    row = await create_task_row(db, user, kind="scene", provider=image_provider.name, input=task_input)
    await db.commit()

    async def work() -> dict[str, Any]:
        before = await resolve_image_ref(image_refs[0])
        return {"imageUrl": await _store_generated(await image_provider.edit(prompt, before))}

    runner.submit(row.id, work)
    return {"task_id": str(row.id), "task_status": "submitted"}


async def query_scene(db: AsyncSession, user: Profile, task_id: str) -> dict[str, Any]:
    row = await get_owned_task(db, user, task_id, "scene")

    if row.status == "running" and row.provider_task_id:
        image_provider = get_providers().image
        if image_provider.is_async and image_provider.name == row.provider:
            status = await image_provider.query(row.provider_task_id)
            if status.done:
                if status.succeeded and status.image:
                    row.status, row.result = "succeeded", {"imageUrl": await _store_generated(status.image)}
                else:
                    row.status, row.error = "failed", status.message
                await db.commit()

    if row.status == "succeeded":
        return {"task_status": "succeed", "images": [{"url": (row.result or {}).get("imageUrl")}]}
    if row.status == "failed":
        return {"task_status": "failed", "task_status_msg": f"生图失败：{row.error}"}
    return {"task_status": "processing"}


# ---- chat (streamed; recorded for quota) ----


async def open_chat_stream(db: AsyncSession, user: Profile, messages: list[dict[str, Any]]):
    llm = get_providers().llm
    await enforce_quota(db, user, "chat")
    row = await create_task_row(
        db, user, kind="chat", provider=llm.name, input={"messages": len(messages)}, status="running"
    )
    await db.commit()
    try:
        stream = await llm.stream_chat(messages)
    except Exception as exc:
        await set_task_state(row.id, status="failed", error=str(exc)[:500])
        raise
    await set_task_state(row.id, status="succeeded")
    return stream
