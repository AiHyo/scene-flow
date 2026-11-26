"""Persistent AI tasks, restart recovery, ownership and rate limiting."""

from __future__ import annotations

import asyncio
import uuid

import pytest
import respx
from sqlalchemy import func, select

from app.ai.tasks import INTERRUPTED_MESSAGE, recover_interrupted_tasks, runner
from app.core.config import settings
from app.core.database import AsyncSessionLocal
from app.models.ai_task import AiTask

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32
IMAGE_URL = "http://minio.test/media/venue/hall.png"


@pytest.fixture
def ai_configured(monkeypatch):
    monkeypatch.setattr(settings, "llm_api_key", "sk-test")
    monkeypatch.setattr(settings, "llm_base_url", "https://llm.test/v1")
    monkeypatch.setattr(settings, "vision_base_url", "")
    monkeypatch.setattr(settings, "vision_api_key", "")
    monkeypatch.setattr(settings, "img_gen_provider", "openai")


@pytest.fixture
async def hall_image(storage):
    await storage.put("venue/hall.png", PNG, "image/png")


async def _rows(**filters) -> list[AiTask]:
    async with AsyncSessionLocal() as db:
        stmt = select(AiTask)
        for k, v in filters.items():
            stmt = stmt.where(getattr(AiTask, k) == v)
        return list((await db.scalars(stmt)).all())


async def _vision(client, session, url=IMAGE_URL):
    return await client.post(
        "/api/v1/ai/vision/request", json={"question": "描述场地", "url": url}, headers=session.headers
    )


async def _vision_result(client, session, task_id):
    return await client.post("/api/v1/ai/vision/result", json={"taskId": task_id}, headers=session.headers)


# ---------------------------------------------------------------- persistence


async def test_vision_task_is_persisted_and_owned(client, make_guest, ai_configured, hall_image):
    owner, other = await make_guest(), await make_guest()
    with respx.mock(assert_all_mocked=True) as mock:
        mock.post("https://llm.test/v1/chat/completions").respond(
            200, json={"choices": [{"message": {"content": "落地窗大厅"}}]}
        )
        task_id = (await _vision(client, owner)).json()["taskId"]
        await runner.wait_idle()

    [row] = await _rows(id=uuid.UUID(task_id))
    assert (row.status, row.kind, str(row.owner_id)) == ("succeeded", "vision", owner.id)
    assert row.result == {"description": "落地窗大厅"}

    ok = await _vision_result(client, owner, task_id)
    assert ok.json() == {"retCode": 0, "description": "落地窗大厅"}

    # Results stay queryable (the old in-memory version deleted them after one read).
    assert (await _vision_result(client, owner, task_id)).json()["retCode"] == 0

    # Someone else's task id, or garbage, is an indistinguishable 404.
    assert (await _vision_result(client, other, task_id)).status_code == 404
    assert (await _vision_result(client, owner, "not-a-uuid")).status_code == 404
    assert (await _vision_result(client, owner, str(uuid.uuid4()))).status_code == 404


async def test_upstream_failure_is_recorded(client, make_guest, ai_configured, hall_image):
    guest = await make_guest()
    with respx.mock(assert_all_mocked=True) as mock:
        mock.post("https://llm.test/v1/chat/completions").respond(500, text="boom")
        task_id = (await _vision(client, guest)).json()["taskId"]
        await runner.wait_idle()

    body = (await _vision_result(client, guest, task_id)).json()
    assert body["retCode"] == -1
    assert "HTTP 500" in body["description"]


async def test_restart_marks_interrupted_tasks_failed(client, make_guest):
    guest = await make_guest()
    async with AsyncSessionLocal() as db:
        stuck = AiTask(owner_id=uuid.UUID(guest.id), kind="vision", status="running", provider="openai", input={})
        kling = AiTask(
            owner_id=uuid.UUID(guest.id),
            kind="scene",
            status="running",
            provider="kling",
            provider_task_id="k-1",
            input={},
        )
        db.add_all([stuck, kling])
        await db.commit()
        stuck_id, kling_id = stuck.id, kling.id

    assert await recover_interrupted_tasks() == 1

    body = (await _vision_result(client, guest, str(stuck_id))).json()
    assert body == {"retCode": -1, "description": f"识图失败：{INTERRUPTED_MESSAGE}"}
    # Provider-side (Kling) tasks keep running: their state lives at the provider.
    [k] = await _rows(id=kling_id)
    assert k.status == "running"


# ---------------------------------------------------------------- kling


@pytest.fixture
def kling_configured(monkeypatch, ai_configured):
    monkeypatch.setattr(settings, "img_gen_provider", "kling")
    monkeypatch.setattr(settings, "img_gen_base_url", "https://kling.test")
    monkeypatch.setattr(settings, "img_gen_api_key", "kling-key")


async def test_kling_task_is_refreshed_from_provider(client, make_guest, kling_configured, hall_image, storage):
    guest = await make_guest()
    with respx.mock(assert_all_mocked=True) as mock:
        submit = mock.post("https://kling.test/v1/images/omni-image").respond(
            200, json={"data": {"task_id": "k-42", "task_status": "submitted"}}
        )
        resp = await client.post(
            "/api/v1/ai/scene/submit",
            json={"prompt": "布置", "image_list": [{"image": IMAGE_URL}]},
            headers=guest.headers,
        )
        assert resp.status_code == 200, resp.text
        task_id = resp.json()["task_id"]
        # Kling fetches the image itself and only ever sees our bucket URL.
        assert IMAGE_URL in submit.calls.last.request.content.decode()

        status = mock.get("https://kling.test/v1/images/omni-image/k-42")
        status.respond(200, json={"data": {"task_status": "processing"}})
        q = await client.post("/api/v1/ai/scene/query", json={"task_id": task_id}, headers=guest.headers)
        assert q.json() == {"task_status": "processing"}

        status.respond(
            200,
            json={"data": {"task_status": "succeed", "task_result": {"images": [{"url": "https://cdn.kling/r.jpg"}]}}},
        )
        mock.get("https://cdn.kling/r.jpg").respond(200, content=b"\xff\xd8\xffresult")
        done = (await client.post("/api/v1/ai/scene/query", json={"task_id": task_id}, headers=guest.headers)).json()

    assert done["task_status"] == "succeed"
    key = done["images"][0]["url"].removeprefix("http://minio.test/media/")
    assert key.startswith("generated/") and (await storage.get(key)).data == b"\xff\xd8\xffresult"
    [row] = await _rows(id=uuid.UUID(task_id))
    assert row.status == "succeeded"


async def test_kling_submit_failure_consumes_no_quota(client, make_guest, kling_configured, hall_image):
    guest = await make_guest()
    with respx.mock(assert_all_mocked=True) as mock:
        mock.post("https://kling.test/v1/images/omni-image").respond(500, json={"message": "provider down"})
        resp = await client.post(
            "/api/v1/ai/scene/submit",
            json={"prompt": "布置", "image_list": [{"image": IMAGE_URL}]},
            headers=guest.headers,
        )
    assert resp.status_code == 502
    assert await _rows(kind="scene") == []


# ---------------------------------------------------------------- quota


async def test_vision_quota_returns_429_with_retry_after(client, make_guest, ai_configured, hall_image, monkeypatch):
    monkeypatch.setattr(settings, "quota_vision_guest_per_hour", 2)
    guest = await make_guest()
    with respx.mock(assert_all_mocked=True) as mock:
        mock.post("https://llm.test/v1/chat/completions").respond(
            200, json={"choices": [{"message": {"content": "x"}}]}
        )
        assert (await _vision(client, guest)).status_code == 200
        assert (await _vision(client, guest)).status_code == 200
        limited = await _vision(client, guest)
        await runner.wait_idle()

    assert limited.status_code == 429
    retry_after = int(limited.headers["Retry-After"])
    assert 3500 <= retry_after <= 3600
    assert limited.json()["code"] == "rate_limited"
    assert limited.json()["retryAfter"] == retry_after


async def test_accounts_get_a_higher_limit_than_guests(client, make_guest, make_account, ai_configured, hall_image):
    from app.ai.quota import limit_for
    from app.models.profile import Profile

    assert limit_for(Profile(is_anon=False), "scene") > limit_for(Profile(is_anon=True), "scene")


async def test_quota_holds_under_concurrent_burst(client, make_guest, ai_configured, hall_image, monkeypatch):
    """The advisory lock makes count+insert atomic: a parallel burst cannot overshoot."""
    monkeypatch.setattr(settings, "quota_vision_guest_per_hour", 3)
    guest = await make_guest()
    with respx.mock(assert_all_mocked=True) as mock:
        mock.post("https://llm.test/v1/chat/completions").respond(
            200, json={"choices": [{"message": {"content": "x"}}]}
        )
        results = await asyncio.gather(*[_vision(client, guest) for _ in range(8)])
        await runner.wait_idle()

    codes = sorted(r.status_code for r in results)
    assert codes == [200] * 3 + [429] * 5
    async with AsyncSessionLocal() as db:
        assert await db.scalar(select(func.count()).select_from(AiTask)) == 3


async def test_chat_is_rate_limited_and_recorded(client, make_guest, ai_configured, monkeypatch):
    monkeypatch.setattr(settings, "quota_chat_guest_per_hour", 1)
    guest = await make_guest()
    body = {"project": {}, "userText": "hi"}
    with respx.mock(assert_all_mocked=True) as mock:
        mock.post("https://llm.test/v1/chat/completions").respond(
            200,
            content=b'data: {"choices":[{"delta":{"content":"hi"}}]}\n\n',
            headers={"content-type": "text/event-stream"},
        )
        first = await client.post("/api/v1/ai/plan/chat", json=body, headers=guest.headers)
        second = await client.post("/api/v1/ai/plan/chat", json=body, headers=guest.headers)

    assert first.status_code == 200 and "hi" in first.text
    assert second.status_code == 429
    [row] = await _rows(kind="chat")
    assert row.status == "succeeded"


async def test_quota_lock_wait_is_bounded(client, make_guest, ai_configured, hall_image, monkeypatch):
    """If another transaction holds this user's quota lock, the request gives up
    with 429 after the lock timeout instead of hanging."""
    from sqlalchemy import text

    monkeypatch.setattr("app.ai.quota.LOCK_WAIT_MS", 300)
    guest = await make_guest()
    async with AsyncSessionLocal() as holder:
        await holder.execute(text("SELECT pg_advisory_xact_lock(hashtext(:k))"), {"k": f"ai-quota:{guest.id}:vision"})
        started = asyncio.get_running_loop().time()
        resp = await _vision(client, guest)
        elapsed = asyncio.get_running_loop().time() - started
        await holder.rollback()

    assert resp.status_code == 429
    assert resp.headers["Retry-After"] == "1"
    assert elapsed < 3
    assert await _rows(kind="vision") == []
