"""Provider selection and demo mode (no API key)."""

from __future__ import annotations

import asyncio
import json
from pathlib import Path

import pytest
import respx

from app.ai.image_refs import seed_sample_venues
from app.ai.providers import ai_mode, get_providers
from app.ai.providers.mock import DEMO_VISION_DESCRIPTION, MockLLM
from app.ai.tasks import runner
from app.core.config import settings
from app.core.errors import ServiceMisconfigured

SAMPLE_DIR = Path(__file__).resolve().parents[2] / "public" / "images" / "layout-reference"
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32


def sse_text(body: str) -> str:
    """Reassemble the streamed reply from OpenAI chunk frames."""
    out = []
    for line in body.splitlines():
        if line.startswith("data: ") and line != "data: [DONE]":
            out.append(json.loads(line[6:])["choices"][0]["delta"].get("content", ""))
    return "".join(out)


@pytest.fixture
def demo(monkeypatch):
    monkeypatch.setattr(settings, "ai_provider", "auto")
    monkeypatch.setattr(settings, "llm_api_key", "")
    monkeypatch.setattr(settings, "mock_stream_delay_ms", 0)


# ---------------------------------------------------------------- selection


@pytest.mark.parametrize(
    ("provider", "key", "expected"),
    [("auto", "", "demo"), ("auto", "sk-x", "live"), ("mock", "sk-x", "demo"), ("openai", "sk-x", "live")],
)
def test_ai_mode_resolution(monkeypatch, provider, key, expected):
    monkeypatch.setattr(settings, "ai_provider", provider)
    monkeypatch.setattr(settings, "llm_api_key", key)
    assert ai_mode() == expected
    assert get_providers().mode == expected


def test_forced_openai_without_key_is_misconfigured(monkeypatch):
    monkeypatch.setattr(settings, "ai_provider", "openai")
    monkeypatch.setattr(settings, "llm_api_key", "")
    with pytest.raises(ServiceMisconfigured):
        get_providers()


def test_kling_requires_its_own_endpoint(monkeypatch):
    monkeypatch.setattr(settings, "ai_provider", "openai")
    monkeypatch.setattr(settings, "llm_api_key", "sk-x")
    monkeypatch.setattr(settings, "img_gen_provider", "kling")
    monkeypatch.setattr(settings, "img_gen_base_url", "")
    with pytest.raises(ServiceMisconfigured, match="kling"):
        get_providers()


async def test_status_endpoint_reports_mode(client, monkeypatch):
    monkeypatch.setattr(settings, "llm_api_key", "")
    assert (await client.get("/api/v1/ai/status")).json() == {"mode": "demo"}
    monkeypatch.setattr(settings, "llm_api_key", "sk-x")
    assert (await client.get("/api/v1/ai/status")).json() == {"mode": "live"}


# ---------------------------------------------------------------- demo mode, end to end through the API


async def test_demo_chat_streams_without_any_network(client, make_guest, demo):
    guest = await make_guest()
    with respx.mock(assert_all_mocked=True, assert_all_called=False) as mock:
        anything = mock.route().respond(500)
        resp = await client.post(
            "/api/v1/ai/plan/chat", json={"project": {}, "userText": "你好"}, headers=guest.headers
        )
    assert resp.status_code == 200
    assert resp.text.rstrip().endswith("data: [DONE]")
    assert "演示模式" in sse_text(resp.text)
    assert anything.call_count == 0


async def test_mock_llm_emits_openai_chunk_frames():
    frames = [f async for f in await MockLLM(delay_ms=0, reply_for=lambda _m: "你好世界").stream_chat([])]
    assert frames[0].startswith(b'data: {"id": "chatcmpl-demo-')
    assert b'"object": "chat.completion.chunk"' in frames[0]
    assert frames[-1] == b"data: [DONE]\n\n"


async def test_demo_vision_returns_labelled_example(client, make_guest, demo, storage):
    await storage.put("venue/hall.png", PNG, "image/png")
    guest = await make_guest()
    task_id = (
        await client.post(
            "/api/v1/ai/vision/request",
            json={"question": "描述场地", "url": "http://minio.test/media/venue/hall.png"},
            headers=guest.headers,
        )
    ).json()["taskId"]
    await runner.wait_idle()
    body = (await client.post("/api/v1/ai/vision/result", json={"taskId": task_id}, headers=guest.headers)).json()
    assert body == {"retCode": 0, "description": DEMO_VISION_DESCRIPTION}
    assert "演示模式" in body["description"]


async def _scene(client, guest, ref):
    sub = await client.post(
        "/api/v1/ai/scene/submit", json={"prompt": "布置", "image_list": [{"image": ref}]}, headers=guest.headers
    )
    assert sub.status_code == 200, sub.text
    await runner.wait_idle()
    return (
        await client.post("/api/v1/ai/scene/query", json={"task_id": sub.json()["task_id"]}, headers=guest.headers)
    ).json()


async def test_demo_scene_returns_prepared_after_image_for_samples(client, make_guest, demo, storage):
    await seed_sample_venues(SAMPLE_DIR)
    guest = await make_guest()
    result = await _scene(client, guest, "/images/layout-reference/02-graduation-before.png")

    assert result["task_status"] == "succeed"
    key = result["images"][0]["url"].removeprefix("http://minio.test/media/")
    assert (await storage.get(key)).data == (SAMPLE_DIR / "02-graduation-after.png").read_bytes()


async def test_demo_scene_refuses_user_photos_instead_of_faking(client, make_guest, demo, storage):
    await storage.put("venue/mine.png", PNG, "image/png")
    guest = await make_guest()
    result = await _scene(client, guest, "http://minio.test/media/venue/mine.png")

    assert result["task_status"] == "failed"
    assert "演示模式仅支持样例场地" in result["task_status_msg"]


async def test_demo_chat_is_still_rate_limited(client, make_guest, demo, monkeypatch):
    monkeypatch.setattr(settings, "quota_chat_guest_per_hour", 1)
    guest = await make_guest()
    body = {"project": {}, "userText": "你好"}
    first, second = await asyncio.gather(
        client.post("/api/v1/ai/plan/chat", json=body, headers=guest.headers),
        client.post("/api/v1/ai/plan/chat", json=body, headers=guest.headers),
    )
    assert sorted([first.status_code, second.status_code]) == [200, 429]
