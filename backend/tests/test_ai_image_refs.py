"""SSRF guard and sample-venue resolution for the vision / scene endpoints."""

from __future__ import annotations

import asyncio
import base64
from pathlib import Path

import pytest
import respx

from app.ai.image_refs import SAMPLE_VENUES, seed_sample_venues
from app.core.config import settings

SAMPLE_DIR = Path(__file__).resolve().parents[2] / "public" / "images" / "layout-reference"
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32

HOSTILE_REFS = [
    "http://169.254.169.254/latest/meta-data/iam/security-credentials/",
    "http://127.0.0.1:9000/media/venue/x.png",  # right path, wrong host (internal MinIO)
    "http://minio.test.evil.example/media/venue/x.png",
    "http://minio.test/other-bucket/venue/x.png",
    "http://minio.test/media/../secrets",
    "file:///etc/passwd",
    "data:image/png;base64,AAAA",
    "/images/layout-reference/../../etc/passwd",
    "/images/assets/default-avatar.png",  # a real static file, but not a registered sample
]


@pytest.fixture
def ai_configured(monkeypatch):
    monkeypatch.setattr(settings, "llm_api_key", "sk-test")
    monkeypatch.setattr(settings, "llm_base_url", "https://llm.test/v1")
    monkeypatch.setattr(settings, "vision_base_url", "")
    monkeypatch.setattr(settings, "vision_api_key", "")
    monkeypatch.setattr(settings, "img_gen_provider", "openai")
    monkeypatch.setattr(settings, "img_gen_base_url", "")
    monkeypatch.setattr(settings, "img_gen_api_key", "")


async def _poll(fn, done, attempts=50):
    for _ in range(attempts):
        body = await fn()
        if done(body):
            return body
        await asyncio.sleep(0.02)
    raise AssertionError(f"task did not finish: {body}")


@pytest.mark.parametrize("ref", HOSTILE_REFS)
async def test_vision_rejects_foreign_refs_without_fetching(client, make_guest, ai_configured, ref):
    guest = await make_guest()
    with respx.mock(assert_all_mocked=True, assert_all_called=False) as mock:
        anything = mock.route().respond(200)
        resp = await client.post(
            "/api/v1/ai/vision/request", json={"question": "描述场地", "url": ref}, headers=guest.headers
        )
        await asyncio.sleep(0.05)  # give any (wrongly) spawned background task a chance to run
    assert resp.status_code == 400, resp.text
    assert anything.call_count == 0


@pytest.mark.parametrize("ref", HOSTILE_REFS)
async def test_scene_rejects_foreign_refs_without_fetching(client, make_guest, ai_configured, ref):
    guest = await make_guest()
    with respx.mock(assert_all_mocked=True, assert_all_called=False) as mock:
        anything = mock.route().respond(200)
        resp = await client.post(
            "/api/v1/ai/scene/submit",
            json={"prompt": "布置", "image_list": [{"image": ref}]},
            headers=guest.headers,
        )
        await asyncio.sleep(0.05)
    assert resp.status_code == 400, resp.text
    assert anything.call_count == 0


async def test_vision_reads_own_bucket_image_from_storage_not_http(client, make_guest, ai_configured, storage):
    await storage.put("venue/hall.png", PNG, "image/png")
    guest = await make_guest()

    with respx.mock(assert_all_mocked=True) as mock:
        llm = mock.post("https://llm.test/v1/chat/completions").respond(
            200, json={"choices": [{"message": {"content": "一间带落地窗的大厅"}}]}
        )
        submitted = await client.post(
            "/api/v1/ai/vision/request",
            json={"question": "描述场地", "url": "http://minio.test/media/venue/hall.png"},
            headers=guest.headers,
        )
        assert submitted.status_code == 200, submitted.text
        task_id = submitted.json()["taskId"]

        async def fetch():
            r = await client.post("/api/v1/ai/vision/result", json={"taskId": task_id}, headers=guest.headers)
            return r.json()

        result = await _poll(fetch, lambda b: b["retCode"] != 1)

    assert result == {"retCode": 0, "description": "一间带落地窗的大厅"}
    # Exactly one outbound call (the model); any other request would have been unmocked
    # and failed the task. The image travelled inline as base64.
    assert llm.call_count == 1
    sent = llm.calls.last.request.content.decode()
    assert base64.b64encode(PNG).decode() in sent


async def test_seed_sample_venues_is_idempotent(storage):
    assert await seed_sample_venues(SAMPLE_DIR) == len(SAMPLE_VENUES)
    assert await seed_sample_venues(SAMPLE_DIR) == 0
    for key in SAMPLE_VENUES.values():
        assert await storage.exists(key)


async def test_seed_tolerates_missing_source_dir(storage, tmp_path):
    assert await seed_sample_venues(tmp_path / "missing") == 0


async def test_scene_generation_works_with_sample_venue(client, make_guest, ai_configured, storage):
    """Regression: sample venues used to fail with 「缺少有效的场地原图」."""
    await seed_sample_venues(SAMPLE_DIR)
    guest = await make_guest()
    sample_ref = "/images/layout-reference/01-lawn-before.png"
    generated = base64.b64encode(PNG).decode()

    with respx.mock(assert_all_mocked=True) as mock:
        edits = mock.post("https://llm.test/v1/images/edits").respond(200, json={"data": [{"b64_json": generated}]})
        submitted = await client.post(
            "/api/v1/ai/scene/submit",
            json={"prompt": "草坪团建布置", "image_list": [{"image": sample_ref}]},
            headers=guest.headers,
        )
        assert submitted.status_code == 200, submitted.text
        task_id = submitted.json()["task_id"]

        async def fetch():
            r = await client.post("/api/v1/ai/scene/query", json={"task_id": task_id}, headers=guest.headers)
            return r.json()

        result = await _poll(fetch, lambda b: b["task_status"] != "processing")

    assert result["task_status"] == "succeed", result
    out_key = result["images"][0]["url"].removeprefix("http://minio.test/media/")
    assert out_key.startswith("generated/")
    assert (await storage.get(out_key)).data == PNG
    # The sample's real bytes were sent to the model as the edit base image.
    sample_bytes = (SAMPLE_DIR / "01-lawn-before.png").read_bytes()
    assert sample_bytes[:64] in edits.calls.last.request.content


async def test_scene_with_unseeded_sample_reports_failure(client, make_guest, ai_configured):
    guest = await make_guest()
    with respx.mock(assert_all_mocked=True):
        submitted = await client.post(
            "/api/v1/ai/scene/submit",
            json={"prompt": "布置", "image_list": [{"image": "/images/layout-reference/02-graduation-before.png"}]},
            headers=guest.headers,
        )
        task_id = submitted.json()["task_id"]

        async def fetch():
            r = await client.post("/api/v1/ai/scene/query", json={"task_id": task_id}, headers=guest.headers)
            return r.json()

        result = await _poll(fetch, lambda b: b["task_status"] != "processing")

    assert result["task_status"] == "failed"
    assert "重新上传" in result["task_status_msg"]
